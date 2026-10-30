FROM mediagis/nominatim@sha256:168c30e20fbba0c2e8199fca7a8aa2640e8cc1a62f8b05b1958897796fdb38f1
# Railway private networking supports IPv6; bind the API on both address families.
RUN sed -i 's/--bind :8080/--bind [::]:8080/' /app/start.sh
ENV PBF_URL=https://download.geofabrik.de/south-america/paraguay-latest.osm.pbf \
    IMPORT_STYLE=address THREADS=2 GUNICORN_WORKERS=2 \
    POSTGRES_SHARED_BUFFERS=256MB POSTGRES_MAINTENANCE_WORK_MEM=512MB \
    POSTGRES_AUTOVACUUM_WORK_MEM=128MB POSTGRES_WORK_MEM=16MB \
    POSTGRES_EFFECTIVE_CACHE_SIZE=1GB IMPORT_WIKIPEDIA=false \
    IMPORT_US_POSTCODES=false IMPORT_GB_POSTCODES=false IMPORT_TIGER_ADDRESSES=false
EXPOSE 8080
