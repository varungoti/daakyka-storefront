# F-305: pinned by digest (the multi-arch index of python:3.11-slim, 3.11.17 on Debian
# trixie, resolved 2026-10-02) so a rebuild cannot silently pick up a different base image.
# Dependabot (.github/dependabot.yml, docker ecosystem) proposes the bump; to refresh by hand:
#   docker buildx imagetools inspect python:3.11-slim   (use the top-level Digest)
FROM python:3.14-slim@sha256:a2b82f3c48559aa0a8446d9af49826b6e2b2016f4cd2afabfe6013ec53729170

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
