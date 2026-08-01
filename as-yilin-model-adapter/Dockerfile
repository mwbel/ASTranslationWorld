FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY common ./common
COPY adapter_server ./adapter_server
COPY examples/zeabur-gemini-direct.config.yaml /config/config.yaml

ENV ADAPTER_CONFIG=/config/config.yaml
ENV ADAPTER_DATA_DIR=/data/adapter
ENV PORT=18081
EXPOSE 18081

CMD ["sh", "-c", "uvicorn adapter_server.app:app --host 0.0.0.0 --port ${PORT:-18081}"]
