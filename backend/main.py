"""
main.py — CAD-Search SaaS Backend
Multi-tenant: her müşteri kendi PostgreSQL schema'sında izole çalışır.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import init_db
from routes.auth import router as auth_router
from routes.index import router as index_router
from routes.search import router as search_router
from routes.categories import router as categories_router
from routes.history import router as history_router
from routes.analytics import router as analytics_router
from routes.contour import router as contour_router
from routes.activity import router as activity_router
from routes.scan import router as scan_router
from routes.jobs import router as jobs_router
from routes.reports import router as reports_router
from routes.model3d import router as model3d_router
from routes.cad_tools import router as cad_tools_router
from routes.nl_search import router as nl_search_router
from routes.attributes import router as attributes_router
from routes.attr_search import router as attr_search_router
from routes.admin import router as admin_router

app = FastAPI(
    title="CAD Arama Motoru",
    description="DWG/DXF dosyaları arasında AI destekli benzerlik araması",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup_event():
    init_db()


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


# Router'ları kaydet
app.include_router(auth_router)        # /auth/register, /auth/login
app.include_router(index_router)       # /index, /index/bulk
app.include_router(search_router)      # /search, /files, /stats
app.include_router(categories_router)  # /categories CRUD
app.include_router(history_router)     # /history
app.include_router(analytics_router)   # /analytics
app.include_router(contour_router)     # /contour/vectorize
app.include_router(activity_router)    # /activity
app.include_router(scan_router)        # /scan/convert, /scan/export-dxf
app.include_router(jobs_router)        # /jobs
app.include_router(reports_router)     # /reports
app.include_router(model3d_router)    # /files/{id}/model3d
app.include_router(cad_tools_router)  # /cad/tools/health, /cad/convert, ...
app.include_router(nl_search_router)  # /nl-search
app.include_router(attributes_router) # /attributes/definitions, /attributes/files/{id}
app.include_router(attr_search_router) # /attr-search
app.include_router(admin_router)       # /admin/members, /admin/stats
