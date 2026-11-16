# Simple Ticketing Backend (Python + FastAPI + Pydantic)

## Run Locally

```bash
cd python_backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Once running, open the interactive Swagger UI generated from your Pydantic models at:
`http://127.0.0.1:8000/docs`
