#!/usr/bin/env python3
"""
WSGI entry point for CyberPanel deployment
This file serves as the entry point for your FastAPI application in CyberPanel's WSGI environment.
"""

import sys
import os
from pathlib import Path

# Add the application directory to Python path
app_dir = Path(__file__).parent.absolute()
sys.path.insert(0, str(app_dir))

# Set environment variables for production
os.environ.setdefault('FASTAPI_ENV', 'production')

# Import the FastAPI app
from main import app

# For WSGI compatibility, we need to wrap FastAPI with ASGI-to-WSGI adapter
try:
    from asgiref.wsgi import WsgiToAsgi
    application = WsgiToAsgi(app)
except ImportError:
    # Fallback: use uvicorn's WSGI interface if asgiref not available
    import uvicorn
    application = uvicorn.run(app, host="0.0.0.0", port=8000, return_callable=True)

# Alternative WSGI application (comment out above and uncomment below if needed)
# from uvicorn.middleware.wsgi import WSGIMiddleware
# application = WSGIMiddleware(app)