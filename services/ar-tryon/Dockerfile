FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

RUN useradd --create-home --uid 1000 appuser
USER appuser

EXPOSE 8080

# Railway/Render inject $PORT at runtime; fall back to 8080 for plain
# `docker compose up` locally. Needs a shell for the variable
# substitution, so this can't be the exec-form JSON array.
CMD sh -c 'uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}'
