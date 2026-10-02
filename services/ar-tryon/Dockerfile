# F-305: pinned by digest (the multi-arch index of python:3.11-slim, 3.11.17 on Debian
# trixie, resolved 2026-10-02) so a rebuild cannot silently pick up a different base image.
# Dependabot (.github/dependabot.yml, docker ecosystem) proposes the bump; to refresh by hand:
#   docker buildx imagetools inspect python:3.11-slim   (use the top-level Digest)
FROM python:3.11-slim@sha256:bab1b7ef4b450c81002278d035eff85ebe394ae94df904f7a3ba14f7e16e487b

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
