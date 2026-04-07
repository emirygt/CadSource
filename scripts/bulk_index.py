#!/usr/bin/env python3
"""
bulk_index.py — 6000 DWG/DXF dosyasını toplu indeksle

Kullanım:
  python bulk_index.py --dir /path/to/dwg/files --workers 8
  python bulk_index.py --dir /mnt/nas/cad --ext dxf --workers 4
  python bulk_index.py --dir /path --resume   # Yarım kalan indekslemeye devam et

Özellikler:
  - Paralel işleme (--workers)
  - İlerleme çubuğu
  - Hata toleransı (bozuk dosyaları atla)
  - Kaldığı yerden devam (--resume)
  - Detaylı log dosyası
"""
import os
import sys
import argparse
import logging
import time
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime

# PostgreSQL bağlantısı için
sys.path.insert(0, os.path.dirname(__file__))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(f"index_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def process_file(args):
    """Tek dosyayı işle — ProcessPoolExecutor ile paralel çalışır."""
    filepath, db_url = args
    try:
        from features import parse_dxf_file, extract_features, extract_stats
        from sqlalchemy import create_engine
        from sqlalchemy.orm import sessionmaker
        from db import CadFile, Base
        import datetime as dt

        engine = create_engine(db_url, pool_pre_ping=True)
        Session = sessionmaker(bind=engine)
        db = Session()

        # Daha önce indekslenmiş mi?
        existing = db.query(CadFile).filter(CadFile.filepath == str(filepath)).first()
        if existing and existing.feature_vector is not None:
            db.close()
            return ("skipped", filepath)

        data = parse_dxf_file(str(filepath))
        if data is None:
            db.close()
            return ("failed", filepath)

        vec = extract_features(data)
        stats = extract_stats(data)
        filename = Path(filepath).name
        ext = filename.lower().split(".")[-1]

        if existing:
            existing.feature_vector = vec.tolist()
            for k, v in stats.items():
                setattr(existing, k, v)
        else:
            cad = CadFile(
                filename=filename,
                filepath=str(filepath),
                file_format=ext,
                feature_vector=vec.tolist(),
                indexed_at=dt.datetime.utcnow(),
                **stats,
            )
            db.add(cad)

        db.commit()
        db.close()
        return ("ok", filepath)

    except Exception as e:
        return ("error", filepath, str(e))


def main():
    parser = argparse.ArgumentParser(description="CAD Dosya Toplu İndeksleyici")
    parser.add_argument("--dir", required=True, help="DWG/DXF dosyalarının bulunduğu klasör")
    parser.add_argument("--ext", default="dxf,dwg", help="Dosya uzantıları (virgülle, varsayılan: dxf,dwg)")
    parser.add_argument("--workers", type=int, default=4, help="Paralel işçi sayısı (varsayılan: 4)")
    parser.add_argument("--resume", action="store_true", help="Daha önce indekslenenları atla")
    parser.add_argument("--db", default=os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/cad_search"),
                        help="PostgreSQL bağlantı URL'i")
    parser.add_argument("--batch-size", type=int, default=100, help="Her batch'te işlenecek dosya sayısı")
    args = parser.parse_args()

    # Dosyaları tara
    extensions = [f".{e.strip().lower()}" for e in args.ext.split(",")]
    root = Path(args.dir)
    if not root.exists():
        log.error(f"Klasör bulunamadı: {args.dir}")
        sys.exit(1)

    files = []
    for ext in extensions:
        files.extend(root.rglob(f"*{ext}"))
    files = sorted(set(files))

    if not files:
        log.warning(f"Hiç dosya bulunamadı: {root} ({', '.join(extensions)})")
        sys.exit(0)

    log.info(f"Toplam {len(files)} dosya bulundu.")
    log.info(f"Paralel işçi: {args.workers}")

    # Veritabanını başlat
    from sqlalchemy import create_engine
    from db import init_db, CadFile
    from sqlalchemy.orm import sessionmaker
    engine = create_engine(args.db)
    init_db_engine(engine)

    # İlerleme takibi
    start = time.time()
    ok_count = skip_count = fail_count = error_count = 0
    total = len(files)

    tasks = [(f, args.db) for f in files]

    with ProcessPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_file, t): t[0] for t in tasks}
        for i, future in enumerate(as_completed(futures), 1):
            result = future.result()
            status = result[0]
            filepath = result[1]

            if status == "ok":
                ok_count += 1
            elif status == "skipped":
                skip_count += 1
            elif status == "failed":
                fail_count += 1
                log.warning(f"Okunamadı: {filepath}")
            elif status == "error":
                error_count += 1
                log.error(f"Hata: {filepath} — {result[2] if len(result) > 2 else ''}")

            # İlerleme
            if i % 50 == 0 or i == total:
                elapsed = time.time() - start
                rate = i / elapsed
                eta = (total - i) / rate if rate > 0 else 0
                pct = i / total * 100
                log.info(
                    f"[{i}/{total}] {pct:.1f}% | "
                    f"✓{ok_count} ↷{skip_count} ✗{fail_count} ⚠{error_count} | "
                    f"Hız: {rate:.1f} dosya/s | "
                    f"Kalan: {eta/60:.1f} dk"
                )

    elapsed = time.time() - start
    log.info("=" * 60)
    log.info(f"İndeksleme tamamlandı — {elapsed/60:.1f} dakika")
    log.info(f"  Başarılı  : {ok_count}")
    log.info(f"  Atlandı   : {skip_count}")
    log.info(f"  Okunamadı : {fail_count}")
    log.info(f"  Hata      : {error_count}")
    log.info("=" * 60)


def init_db_engine(engine):
    from sqlalchemy import text
    from db import Base
    with engine.connect() as conn:
        conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        conn.commit()
    Base.metadata.create_all(bind=engine)


if __name__ == "__main__":
    main()
