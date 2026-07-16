import json
import os
import uuid
from contextlib import contextmanager

import httpx
import psycopg
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response, StreamingResponse

DATABASE_URL = os.environ["DATABASE_URL"]
UPSTREAM = os.getenv("SUTRA_UPSTREAM", "http://sutra-server:5555")
app = FastAPI(title="AS译林本地跨页关联服务")


@contextmanager
def db():
    with psycopg.connect(DATABASE_URL) as conn:
        yield conn


@app.on_event("startup")
def migrate():
    with db() as conn, conn.cursor() as cur:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS local_cross_page_links (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          anchor_segment_id uuid NOT NULL UNIQUE REFERENCES segments(id) ON DELETE CASCADE,
          continuation_segment_id uuid NOT NULL UNIQUE REFERENCES segments(id) ON DELETE CASCADE,
          status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed')),
          created_at timestamptz NOT NULL DEFAULT now(),
          CHECK (anchor_segment_id <> continuation_segment_id)
        )
        """)


def link_row(cur, segment_id):
    cur.execute("""
      SELECT id, anchor_segment_id, continuation_segment_id, status, created_at
      FROM local_cross_page_links
      WHERE anchor_segment_id=%s OR continuation_segment_id=%s
    """, (segment_id, segment_id))
    row = cur.fetchone()
    if not row:
        return None
    return dict(zip(("id", "anchor_segment_id", "continuation_segment_id", "status", "created_at"), row))


def validate_adjacent(cur, anchor, continuation):
    cur.execute("""
      SELECT s.id, s.sort_order, p.chapter_id, p.page_number
      FROM segments s JOIN pages p ON p.id=s.page_id WHERE s.id IN (%s,%s)
    """, (anchor, continuation))
    rows = {str(r[0]): r for r in cur.fetchall()}
    if anchor not in rows or continuation not in rows:
        raise HTTPException(404, "段落不存在")
    a, c = rows[anchor], rows[continuation]
    if a[2] != c[2] or c[3] != a[3] + 1:
        raise HTTPException(422, "只能关联同一章节的相邻页面")
    cur.execute("SELECT id FROM segments WHERE page_id=(SELECT page_id FROM segments WHERE id=%s) ORDER BY sort_order DESC LIMIT 1", (anchor,))
    if str(cur.fetchone()[0]) != anchor:
        raise HTTPException(422, "主段必须是上一页最后一段")
    cur.execute("SELECT id FROM segments WHERE page_id=(SELECT page_id FROM segments WHERE id=%s) ORDER BY sort_order LIMIT 1", (continuation,))
    if str(cur.fetchone()[0]) != continuation:
        raise HTTPException(422, "续段必须是下一页第一段")


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/links/by-segment/{segment_id}")
def get_link(segment_id: uuid.UUID):
    with db() as conn, conn.cursor() as cur:
        row = link_row(cur, segment_id)
    return {"link": row}


@app.get("/candidates/by-continuation/{segment_id}")
def get_candidate(segment_id: uuid.UUID):
    with db() as conn, conn.cursor() as cur:
        existing = link_row(cur, segment_id)
        cur.execute("""
          WITH current_segment AS (
            SELECT s.id, s.page_id, s.sort_order, p.chapter_id, p.page_number
            FROM segments s JOIN pages p ON p.id=s.page_id WHERE s.id=%s
          ), previous_page AS (
            SELECT p.id, p.page_number FROM pages p, current_segment c
            WHERE p.chapter_id=c.chapter_id AND p.page_number=c.page_number-1
          ), anchor AS (
            SELECT s.id FROM segments s, previous_page p WHERE s.page_id=p.id
            ORDER BY s.sort_order DESC LIMIT 1
          )
          SELECT c.id, c.sort_order, c.page_number, a.id, p.page_number,
                 (SELECT string_agg(t.text,'' ORDER BY t.sort_order) FROM source_tokens t WHERE t.segment_id=c.id),
                 (SELECT string_agg(t.text,'' ORDER BY t.sort_order) FROM source_tokens t WHERE t.segment_id=a.id)
          FROM current_segment c LEFT JOIN previous_page p ON true LEFT JOIN anchor a ON true
        """, (segment_id,))
        row = cur.fetchone()
        if not row or row[3] is None or row[1] != 0:
            return {"candidate": None, "link": existing}
        return {"candidate": {
            "continuation_segment_id": row[0], "page_number": row[2],
            "anchor_segment_id": row[3], "previous_page_number": row[4],
            "continuation_text": row[5] or "", "anchor_text": row[6] or "",
        }, "link": existing}


@app.post("/links")
async def create_link(request: Request):
    body = await request.json()
    anchor, continuation = str(body.get("anchor_segment_id", "")), str(body.get("continuation_segment_id", ""))
    try:
        uuid.UUID(anchor); uuid.UUID(continuation)
    except ValueError:
        raise HTTPException(422, "段落 ID 无效")
    with db() as conn, conn.cursor() as cur:
        validate_adjacent(cur, anchor, continuation)
        cur.execute("""
          INSERT INTO local_cross_page_links(anchor_segment_id, continuation_segment_id)
          VALUES (%s,%s)
          ON CONFLICT (anchor_segment_id) DO UPDATE SET continuation_segment_id=EXCLUDED.continuation_segment_id
          RETURNING id
        """, (anchor, continuation))
        link_id = cur.fetchone()[0]
    return {"ok": True, "id": link_id}


@app.delete("/links/{link_id}")
def delete_link(link_id: uuid.UUID):
    with db() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM local_cross_page_links WHERE id=%s RETURNING id", (link_id,))
        if not cur.fetchone():
            raise HTTPException(404, "跨页关联不存在")
    return {"ok": True}


def create_shadow(anchor):
    shadow = uuid.uuid4()
    with db() as conn, conn.cursor() as cur:
        row = link_row(cur, anchor)
        if not row or str(row["anchor_segment_id"]) != anchor:
            raise HTTPException(404, "主段没有已确认的跨页关联")
        continuation = str(row["continuation_segment_id"])
        cur.execute("SELECT page_id FROM segments WHERE id=%s", (anchor,))
        page_id = cur.fetchone()[0]
        cur.execute("INSERT INTO segments(id,page_id,sort_order,status) VALUES(%s,%s,2147483000,'raw')", (shadow, page_id))
        cur.execute("""
          INSERT INTO source_tokens(id,segment_id,lang,text,bbox,char_offset_start,char_offset_end,confidence,ocr_source,sort_order,ocr_text)
          SELECT concat('cross-page-',%s::text,'-',row_number() over()), %s, lang, text, bbox,
                 char_offset_start,char_offset_end,confidence,'cross_page_shadow',row_number() over(),ocr_text
          FROM source_tokens WHERE segment_id IN (%s,%s)
          ORDER BY CASE WHEN segment_id=%s THEN 0 ELSE 1 END, sort_order
        """, (shadow, shadow, anchor, continuation, anchor))
    return str(shadow)


def finish_shadow(shadow, anchor):
    with db() as conn, conn.cursor() as cur:
        cur.execute("UPDATE translation_proposals SET segment_id=%s WHERE segment_id=%s", (anchor, shadow))
        cur.execute("DELETE FROM segments WHERE id=%s", (shadow,))


async def forward_translation(request: Request, anchor: str, streaming: bool):
    shadow = create_shadow(anchor)
    suffix = "translate-stream" if streaming else "translate"
    url = f"{UPSTREAM}/api/segments/{shadow}/{suffix}"
    headers = {k: v for k, v in request.headers.items() if k.lower() in ("authorization", "content-type", "accept")}
    body = await request.body()
    if not streaming:
        try:
            async with httpx.AsyncClient(timeout=3600) as client:
                response = await client.post(url, headers=headers, content=body)
            if response.is_success:
                finish_shadow(shadow, anchor)
            else:
                finish_shadow(shadow, anchor)
            return Response(
                content=response.content,
                status_code=response.status_code,
                media_type=response.headers.get("content-type", "application/json").split(";", 1)[0],
            )
        except Exception:
            finish_shadow(shadow, anchor)
            raise

    async def stream():
        try:
            async with httpx.AsyncClient(timeout=3600) as client:
                async with client.stream("POST", url, headers=headers, content=body) as response:
                    async for chunk in response.aiter_bytes():
                        yield chunk
        finally:
            finish_shadow(shadow, anchor)
    return StreamingResponse(stream(), media_type="text/event-stream")


@app.post("/segments/{anchor}/translate")
async def translate(anchor: uuid.UUID, request: Request):
    return await forward_translation(request, str(anchor), False)


@app.post("/segments/{anchor}/translate-stream")
async def translate_stream(anchor: uuid.UUID, request: Request):
    return await forward_translation(request, str(anchor), True)
