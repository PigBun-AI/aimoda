FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY skills ./skills

RUN mkdir -p /data /reports

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 3000 --workers ${API_WORKERS:-4} --backlog ${API_BACKLOG:-1024} --timeout-keep-alive ${API_KEEP_ALIVE_TIMEOUT:-30}"]
