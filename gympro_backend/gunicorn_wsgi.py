#!/usr/bin/env python3
"""
Alternative WSGI entry point using Gunicorn-compatible interface
This provides better compatibility with CyberPanel's Python app hosting
"""

import sys
import os
from pathlib import Path

# Add the application directory to Python path
app_dir = Path(__file__).parent.absolute()
sys.path.insert(0, str(app_dir))

# Load environment variables
from dotenv import load_dotenv
load_dotenv('.env.production')

# Import and configure the FastAPI app
from main import app

# Gunicorn-compatible callable
def application(environ, start_response):
    """
    WSGI application callable for Gunicorn/CyberPanel
    """
    # You can add any WSGI middleware here if needed
    return app(environ, start_response)