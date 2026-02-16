import os
import sys

# Change to the backend directory...
backend_dir = r"d:\git_changes\saloon_backend"
os.chdir(backend_dir)

# Add the backend directory to Python path
sys.path.insert(0, backend_dir)

print(f"Current working directory: {os.getcwd()}")
print(f"Python path: {sys.path[:3]}")

# Import the FastAPI app directly for debugging
from main import app

if __name__ == "__main__":
    import uvicorn
    # For debugging: reload=False to avoid subprocess issues
    print("Starting FastAPI in debug mode...")
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False, log_level="debug")
