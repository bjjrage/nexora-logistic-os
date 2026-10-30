#!/bin/sh
set -eu
cd /data
# A completed dataset is reused on restarts. No historical OS or GPS data is stored here.
if [ ! -f /data/paraguay.mld-ready ]; then
  if [ ! -f /data/paraguay-latest.osm.pbf ]; then
    curl --fail --location --retry 5 https://download.geofabrik.de/south-america/paraguay-latest.osm.pbf --output /data/paraguay-latest.osm.pbf.partial
    mv /data/paraguay-latest.osm.pbf.partial /data/paraguay-latest.osm.pbf
  fi
  osrm-extract --threads 2 -p /opt/car.lua /data/paraguay-latest.osm.pbf
  osrm-partition --threads 2 /data/paraguay-latest.osrm
  osrm-customize --threads 2 /data/paraguay-latest.osrm
  touch /data/paraguay.mld-ready
fi
exec osrm-routed --algorithm mld --ip :: --port "${PORT:-5000}" --max-table-size 100 --threads 2 /data/paraguay-latest.osrm
