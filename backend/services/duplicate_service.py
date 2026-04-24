"""
duplicate_service.py - exact duplicate and revision candidate grouping.
"""
from __future__ import annotations

import hashlib
import json
from typing import Optional

from sqlalchemy import bindparam, text
from sqlalchemy.orm import Session


def compute_content_hash(raw_bytes: Optional[bytes]) -> Optional[str]:
    if not raw_bytes:
        return None
    return hashlib.sha256(raw_bytes).hexdigest()


def compute_geometry_hash(stats: dict) -> str:
    """A coarse stable fingerprint used to find likely revisions."""
    entity_types = stats.get("entity_types") or {}
    layers = stats.get("layers") or []
    payload = {
        "entity_types": sorted((str(k), int(v)) for k, v in entity_types.items()),
        "layers": sorted(str(x).lower() for x in layers),
        "bbox_w": round(float(stats.get("bbox_width") or 0.0), 1),
        "bbox_h": round(float(stats.get("bbox_height") or 0.0), 1),
        "entity_count_bucket": int(float(stats.get("entity_count") or 0) // 10),
        "layer_count": int(stats.get("layer_count") or 0),
    }
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _ensure_group(db: Session, group_type: str, title: str, existing_group_id: Optional[int] = None) -> int:
    if existing_group_id:
        return int(existing_group_id)
    row = db.execute(text("""
        INSERT INTO cad_file_groups (group_type, title)
        VALUES (:group_type, :title)
        RETURNING id
    """), {"group_type": group_type, "title": title}).fetchone()
    return int(row.id)


def _add_member(db: Session, group_id: int, file_id: int, role: str, score: Optional[float], reason: str) -> None:
    db.execute(text("""
        INSERT INTO cad_file_group_members (group_id, file_id, role, score, reason)
        VALUES (:group_id, :file_id, :role, :score, :reason)
        ON CONFLICT (group_id, file_id)
        DO UPDATE SET role = EXCLUDED.role, score = EXCLUDED.score, reason = EXCLUDED.reason
    """), {
        "group_id": group_id,
        "file_id": file_id,
        "role": role,
        "score": score,
        "reason": reason,
    })


def update_duplicate_relationships(
    db: Session,
    *,
    file_id: int,
    filename: str,
    content_hash: Optional[str],
    geometry_hash: Optional[str],
    feature_vector: Optional[str],
) -> dict:
    """Mark file as exact duplicate, revision candidate, or unique."""
    exact_rows = []
    if content_hash:
        exact_rows = db.execute(text("""
            SELECT id, filename, duplicate_group_id
            FROM cad_files
            WHERE id <> :file_id AND content_hash = :content_hash
            ORDER BY id
        """), {"file_id": file_id, "content_hash": content_hash}).fetchall()

    if exact_rows:
        group_id = _ensure_group(
            db,
            "duplicate",
            f"Duplicate: {filename}",
            exact_rows[0].duplicate_group_id,
        )
        _add_member(db, group_id, file_id, "duplicate", 1.0, "same_content_hash")
        for row in exact_rows:
            _add_member(db, group_id, int(row.id), "original", 1.0, "same_content_hash")
        db.execute(text("""
            UPDATE cad_files
            SET duplicate_status = 'exact_duplicate', duplicate_group_id = :group_id
            WHERE id = :file_id OR content_hash = :content_hash
        """), {"group_id": group_id, "file_id": file_id, "content_hash": content_hash})
        return {
            "duplicate_status": "exact_duplicate",
            "duplicate_group_id": group_id,
            "match_count": len(exact_rows),
        }

    candidates = []
    if feature_vector:
        candidates = db.execute(text("""
            SELECT id, filename, duplicate_group_id,
                   1 - (feature_vector <=> CAST(:vec AS vector)) AS similarity
            FROM cad_files
            WHERE id <> :file_id
              AND feature_vector IS NOT NULL
              AND (:geometry_hash IS NULL OR geometry_hash = :geometry_hash)
              AND (:content_hash IS NULL OR content_hash IS NULL OR content_hash <> :content_hash)
            ORDER BY feature_vector <=> CAST(:vec AS vector)
            LIMIT 5
        """), {
            "file_id": file_id,
            "vec": feature_vector,
            "geometry_hash": geometry_hash,
            "content_hash": content_hash,
        }).fetchall()
        candidates = [row for row in candidates if float(row.similarity or 0.0) >= 0.96]

    if candidates:
        group_id = _ensure_group(
            db,
            "revision",
            f"Revision candidates: {filename}",
            candidates[0].duplicate_group_id,
        )
        _add_member(db, group_id, file_id, "candidate", float(candidates[0].similarity), "high_vector_similarity")
        for row in candidates:
            _add_member(db, group_id, int(row.id), "related", float(row.similarity), "high_vector_similarity")
        ids = [int(row.id) for row in candidates] + [file_id]
        stmt = text("""
            UPDATE cad_files
            SET duplicate_status = 'revision_candidate', duplicate_group_id = :group_id
            WHERE id IN :ids
        """).bindparams(bindparam("ids", expanding=True))
        db.execute(stmt, {"group_id": group_id, "ids": ids})
        return {
            "duplicate_status": "revision_candidate",
            "duplicate_group_id": group_id,
            "match_count": len(candidates),
        }

    db.execute(text("""
        UPDATE cad_files
        SET duplicate_status = 'unique', duplicate_group_id = NULL
        WHERE id = :file_id
    """), {"file_id": file_id})
    return {"duplicate_status": "unique", "duplicate_group_id": None, "match_count": 0}
