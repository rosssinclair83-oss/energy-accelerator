from fastapi import FastAPI

app = FastAPI(
    title="Energy Accelerator API",
    description="Backend API for Energy Accelerator v4",
    version="0.1.0"
)

@app.get("/")
async def root():
    return {"message": "Energy Accelerator API is running"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}
