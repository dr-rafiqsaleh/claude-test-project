# backend/run.py
import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=False,        # Must be False for debug
        log_level="info",
        access_log=False,
    )
