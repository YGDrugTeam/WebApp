"""RAG (Retrieval-Augmented Generation) module.

Lightweight, dependency-free retrieval over local JSON knowledge.
"""

from .index import RagIndex
from .sources import build_default_documents

__all__ = ["RagIndex", "build_default_documents"]
