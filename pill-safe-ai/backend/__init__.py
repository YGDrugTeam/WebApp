"""Backend package marker.

This file allows running the FastAPI app as a module package:
  uvicorn backend.main:app

We intentionally keep imports in modules compatible with both:
- package execution (backend.*)
- script execution from the backend/ folder
"""
