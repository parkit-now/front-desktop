"""Camera capture microservice — FastAPI entry point.

Usage:
    python main.py [PORT]     # defaults to 8766
"""

import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Camera Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
