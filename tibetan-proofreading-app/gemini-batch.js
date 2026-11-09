(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const elements = {
    sourceFiles: $('sourceFiles'), taskTitle: $('taskTitle'), modelName: $('modelName'),
    promptText: $('promptText'), sourcePreview: $('sourcePreview'), sourceCount: $('sourceCount'),
    prepareButton: $('prepareButton'), prepareStatus: $('prepareStatus'),
    jobList: $('jobList'), keyStatus: $('keyStatus'), currentTitle: $('currentTitle'),
    currentPages: $('currentPages'), currentState: $('currentState'),
    submitButton: $('submitButton'), refreshButton: $('refreshButton'), retryButton: $('retryButton'),
    batchStatus: $('batchStatus'), pageProgress: $('pageProgress'),
    fetchButton: $('fetchButton'), downloadStatus: $('downloadStatus'),
    inputLink: $('inputLink'), jsonlLink: $('jsonlLink'), txtLink: $('txtLink'),
  };
  const stateLabels = {
    JOB_STATE_PENDING: '等待处理', JOB_STATE_RUNNING: '处理中',
    JOB_STATE_SUCCEEDED: '已完成', JOB_STATE_FAILED: '失败',
    JOB_STATE_CANCELLED: '已取消', JOB_STATE_EXPIRED: '已过期',
  };
  const terminalStates = new Set(['JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);
  const pageLabels = { ready: '待提交', creating: '提交中', submitted: '已提交', running: '处理中', saved: '已保存', failed: '失败', review: '需核对' };
  let currentJob = null;
  let busy = false;
  let pdfDocument = null;
  let pdfSource = null;
  let previewUrl = null;
  let autoTitle = '';

  async function request(path, method = 'GET', payload = null) {
    const options = { method, headers: {} };
    if (method !== 'GET') {
      options.headers['Content-Type'] = 'application/json';
      options.headers['X-Gemini-Batch-UI'] = '1';
      options.body = JSON.stringify(payload || {});
    }
    let response;
    try {
      response = await fetch(path, options);
    } catch (error) {
      throw new Error(`本地服务无法连接：${error.message}`);
    }
    let result;
    try {
      result = await response.json();
    } catch (_) {
      throw new Error(`本地服务返回了无法解析的响应（HTTP ${response.status}）。`);
    }
    if (!response.ok) throw new Error(result.error || `请求失败（HTTP ${response.status}）。`);
    return result;
  }

  function showStatus(element, message, isError = false) {
    element.textContent = message;
    element.classList.toggle('error', isError);
  }

  function setBusy(value) {
    busy = value;
    elements.prepareButton.disabled = value;
    const checkpoint = currentJob?.checkpoint;
    elements.submitButton.disabled = value || !currentJob?.prepared || Boolean(checkpoint ? checkpoint.submitted_at : currentJob?.batch);
    elements.refreshButton.disabled = value || !(checkpoint ? checkpoint.submitted_at : currentJob?.batch);
    elements.retryButton.disabled = value || !checkpoint?.failed;
    elements.fetchButton.disabled = value || !(checkpoint ? checkpoint.saved : currentJob?.batch?.state === 'JOB_STATE_SUCCEEDED');
  }

  function jobState(job) {
    if (job.checkpoint) {
      const { submitted_at, saved, total, failed, review } = job.checkpoint;
      if (!submitted_at) return '已生成请求';
      return `已缓存 ${saved}/${total} 页${failed ? ` · ${failed} 页失败` : ''}${review ? ` · ${review} 页需核对` : ''}`;
    }
    if (!job.batch) return job.prepared ? '已生成请求' : '待生成请求';
    return stateLabels[job.batch.state] || job.batch.state || '状态未知';
  }

  function setDownloadLink(element, job, kind, enabled) {
    element.hidden = !enabled;
    if (enabled) element.href = `/api/jobs/${job.id}/files/${kind}`;
  }

  function showJob(job) {
    currentJob = job;
    elements.currentTitle.textContent = job?.title || '尚未选择';
    elements.currentPages.textContent = job ? `${job.uploaded_pages} / ${job.expected_pages}` : '—';
    elements.currentState.textContent = job ? jobState(job) : '未提交';
    if (job) {
      setDownloadLink(elements.inputLink, job, 'input', job.prepared);
      setDownloadLink(elements.jsonlLink, job, 'jsonl', job.has_result_jsonl);
      setDownloadLink(elements.txtLink, job, 'txt', job.has_result_txt);
      if (job.checkpoint) {
        const progress = job.checkpoint;
        const summary = progress.submitted_at
          ? `已保存 ${progress.saved}/${progress.total} 页；${progress.active} 页处理中。关闭网页后，本地服务会继续检查并保存结果。`
          : '请求已在本机生成，可以提交到 Gemini。';
        const review = progress.review ? `\n${progress.review} 页提交结果不明，请先在 Google 核对，避免重复计费。` : '';
        const errors = progress.pages.filter((page) => page.status === 'failed' || page.status === 'review')
          .map((page) => `第 ${page.page} 页：${page.error || pageLabels[page.status]}`);
        showStatus(elements.batchStatus, [summary + review, ...errors].join('\n'), Boolean(errors.length));
        elements.pageProgress.replaceChildren();
        for (const page of progress.pages) {
          const item = document.createElement('span');
          item.className = page.status;
          item.textContent = `第 ${page.page} 页 · ${pageLabels[page.status] || page.status}`;
          if (page.error) item.title = page.error;
          elements.pageProgress.append(item);
        }
      } else if (job.batch?.job_name) {
        showStatus(elements.batchStatus, `任务编号：${job.batch.job_name}${job.batch.error ? `\n错误：${job.batch.error}` : ''}`, Boolean(job.batch.error));
      } else {
        showStatus(elements.batchStatus, job.prepared ? '请求已在本机生成，可以提交到 Gemini。' : '尚未生成完整请求。');
      }
      if (!job.checkpoint) elements.pageProgress.replaceChildren();
      showStatus(elements.downloadStatus, job.has_result_txt ? `已缓存 ${job.checkpoint?.saved ?? '完成'} 页，可通过下方链接下载。` : '');
      try { localStorage.setItem('tibetan-gemini-batch-current-job', job.id); } catch (_) { /* 仅保存任务编号，存储不可用时仍能继续使用 */ }
    } else {
      [elements.inputLink, elements.jsonlLink, elements.txtLink].forEach((link) => { link.hidden = true; });
      showStatus(elements.batchStatus, '');
      showStatus(elements.downloadStatus, '');
      elements.pageProgress.replaceChildren();
    }
    setBusy(busy);
  }

  async function loadJobs(preferredId = null) {
    const { jobs } = await request('/api/jobs');
    elements.jobList.replaceChildren();
    if (!jobs.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = '暂无任务。选择 PDF 或页图开始。';
      elements.jobList.append(empty);
      showJob(null);
      return;
    }
    let savedId = null;
    try { savedId = localStorage.getItem('tibetan-gemini-batch-current-job'); } catch (_) { /* 不依赖浏览器缓存 */ }
    const selected = jobs.find((job) => job.id === (preferredId || currentJob?.id || savedId)) || jobs[0];
    for (const job of jobs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `job-item${job.id === selected.id ? ' active' : ''}`;
      const title = document.createElement('strong');
      title.textContent = job.title;
      const detail = document.createElement('small');
      detail.textContent = `${job.expected_pages} 页 · ${jobState(job)}`;
      button.append(title, detail);
      button.addEventListener('click', () => {
        showJob(job);
        elements.jobList.querySelectorAll('.job-item').forEach((item) => item.classList.remove('active'));
        button.classList.add('active');
      });
      elements.jobList.append(button);
    }
    showJob(selected);
  }

  async function loadHealth() {
    const health = await request('/api/health');
    elements.keyStatus.textContent = health.api_key_ready && health.sdk_ready
      ? `本地服务和 Gemini API key 已就绪。来源：${health.key_source}。`
      : `提交前还需${!health.sdk_ready ? '安装 google-genai' : ''}${!health.sdk_ready && !health.api_key_ready ? '、' : ''}${!health.api_key_ready ? '设置 GEMINI_API_KEY' : ''}。`;
  }

  function isPdf(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  }

  async function selectedSource() {
    const files = Array.from(elements.sourceFiles.files || []);
    if (!files.length) throw new Error('请先选择一个 PDF 或多张页图。');
    if (files.some(isPdf)) {
      if (files.length !== 1 || !isPdf(files[0])) throw new Error('PDF 请单独选择；页图可多选。');
      if (pdfSource !== files[0]) {
        if (!window.pdfjsLib) throw new Error('PDF 渲染库未加载。');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdf.worker.min.js';
        pdfDocument = await window.pdfjsLib.getDocument({ data: new Uint8Array(await files[0].arrayBuffer()) }).promise;
        pdfSource = files[0];
      }
      return { kind: 'pdf', files, count: pdfDocument.numPages };
    }
    if (files.some((file) => !file.type.startsWith('image/'))) throw new Error('请选择 PDF 或 PNG/JPEG/WebP/GIF 页图。');
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    return { kind: 'images', files, count: files.length };
  }

  function canvasToJpeg(canvas) {
    const toBlob = (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    return (async () => {
      for (const quality of [0.93, 0.82, 0.68]) {
        const blob = await toBlob(quality);
        if (!blob) throw new Error('浏览器无法生成 JPEG 页图。');
        if (blob.size <= 14 * 1024 * 1024) return blob;
      }
      throw new Error('单页转换后仍超过 14 MiB，请先缩小原图。');
    })();
  }

  async function jpegFromPdf(pageNumber) {
    const page = await pdfDocument.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 3200 / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport }).promise;
    return canvasToJpeg(canvas);
  }

  async function jpegFromImage(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, 3200 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return await canvasToJpeg(canvas);
    } finally {
      bitmap.close();
    }
  }

  function blobBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取页图失败。'));
      reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
      reader.readAsDataURL(blob);
    });
  }

  async function previewSource() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    elements.sourcePreview.classList.remove('visible');
    const source = await selectedSource();
    const suggestedTitle = source.kind === 'pdf' ? source.files[0].name : source.files[0].name.replace(/[-_ ]?\d+\.[^.]+$/, '');
    if (!elements.taskTitle.value.trim() || elements.taskTitle.value === autoTitle) {
      elements.taskTitle.value = suggestedTitle;
      autoTitle = suggestedTitle;
    }
    elements.sourceCount.textContent = `${source.count} 页待打包`;
    const blob = source.kind === 'pdf' ? await jpegFromPdf(1) : source.files[0];
    previewUrl = URL.createObjectURL(blob);
    elements.sourcePreview.src = previewUrl;
    elements.sourcePreview.classList.add('visible');
  }

  async function prepareJob() {
    if (busy) return;
    setBusy(true);
    showStatus(elements.prepareStatus, '正在读取文件…');
    try {
      const source = await selectedSource();
      const title = elements.taskTitle.value.trim();
      const prompt = elements.promptText.value.trim();
      const model = elements.modelName.value.trim();
      if (!title || !prompt || !model) throw new Error('请填写任务名称、提示词和模型名称。');
      const { job } = await request('/api/jobs', 'POST', { title, prompt, model, expected_pages: source.count });
      currentJob = job;
      for (let page = 1; page <= source.count; page += 1) {
        showStatus(elements.prepareStatus, `正在处理第 ${page} / ${source.count} 页…`);
        const image = source.kind === 'pdf' ? await jpegFromPdf(page) : await jpegFromImage(source.files[page - 1]);
        await request(`/api/jobs/${job.id}/pages`, 'POST', { page, mime_type: 'image/jpeg', data: await blobBase64(image) });
      }
      const prepared = await request(`/api/jobs/${job.id}/prepare`, 'POST');
      await loadJobs(job.id);
      showStatus(elements.prepareStatus, `已在本机打包 ${prepared.count} 页（${(prepared.input_bytes / 1024 / 1024).toFixed(1)} MiB）。现在可以提交 Batch。`);
    } catch (error) {
      showStatus(elements.prepareStatus, error.message, true);
      await loadJobs(currentJob?.id).catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  async function submitJob() {
    if (busy || !currentJob?.prepared || currentJob.checkpoint?.submitted_at || currentJob.batch) return;
    const jobId = currentJob.id;
    setBusy(true);
    showStatus(elements.batchStatus, '正在启动逐页 Batch 任务…');
    try {
      const { job } = await request(`/api/jobs/${jobId}/submit`, 'POST');
      await loadJobs(job.id);
    } catch (error) {
      showStatus(elements.batchStatus, error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshJob() {
    if (busy || !(currentJob?.checkpoint?.submitted_at || currentJob?.batch)) return;
    const jobId = currentJob.id;
    setBusy(true);
    showStatus(elements.batchStatus, '正在查询 Gemini 任务状态…');
    try {
      const { job } = await request(`/api/jobs/${jobId}/refresh`, 'POST');
      await loadJobs(job.id);
    } catch (error) {
      showStatus(elements.batchStatus, error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function fetchResults() {
    if (busy || !(currentJob?.checkpoint?.saved || currentJob?.batch?.state === 'JOB_STATE_SUCCEEDED')) return;
    const jobId = currentJob.id;
    setBusy(true);
    showStatus(elements.downloadStatus, '正在下载并解析 Gemini 结果…');
    try {
      const result = await request(`/api/jobs/${jobId}/fetch`, 'POST');
      await loadJobs(jobId);
      showStatus(elements.downloadStatus, `已保存 ${result.count} 页${result.errors ? `；${result.errors} 页失败，可单独重试` : ''}。可通过下方链接下载。`);
    } catch (error) {
      showStatus(elements.downloadStatus, error.message, true);
    } finally {
      setBusy(false);
    }
  }

  async function retryFailed() {
    if (busy || !currentJob?.checkpoint?.failed) return;
    const jobId = currentJob.id;
    setBusy(true);
    showStatus(elements.batchStatus, '正在将失败页重新排队…');
    try {
      const result = await request(`/api/jobs/${jobId}/retry`, 'POST');
      await loadJobs(jobId);
      showStatus(elements.batchStatus, `已重新排队 ${result.retried} 页；本地服务将在后台继续处理。`);
    } catch (error) {
      showStatus(elements.batchStatus, error.message, true);
    } finally {
      setBusy(false);
    }
  }

  elements.sourceFiles.addEventListener('change', () => {
    pdfDocument = null;
    pdfSource = null;
    elements.sourceCount.textContent = '';
    previewSource().catch((error) => showStatus(elements.prepareStatus, error.message, true));
  });
  elements.prepareButton.addEventListener('click', prepareJob);
  elements.submitButton.addEventListener('click', submitJob);
  elements.refreshButton.addEventListener('click', refreshJob);
  elements.fetchButton.addEventListener('click', fetchResults);
  elements.retryButton.addEventListener('click', retryFailed);
  setInterval(() => {
    if (!busy && currentJob?.checkpoint?.submitted_at && currentJob.checkpoint.saved < currentJob.checkpoint.total) {
      loadJobs(currentJob.id).catch((error) => showStatus(elements.batchStatus, error.message, true));
    } else if (!busy && currentJob?.batch && !terminalStates.has(currentJob.batch.state)) refreshJob();
  }, 30000);
  Promise.all([loadHealth(), loadJobs()]).catch((error) => {
    showStatus(elements.prepareStatus, error.message, true);
    elements.keyStatus.textContent = '本地服务检查失败。';
  });
})();
