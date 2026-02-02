import { PMTiles } from 'pmtiles';
import { open } from 'node:fs/promises';
import path from 'node:path';

class NodeFileSource {
  constructor(handle, filePath) {
    this.handle = handle;
    this.filePath = filePath;
  }

  getKey() {
    return this.filePath;
  }

  async getBytes(offset, length) {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await this.handle.read(buffer, 0, length, offset);

    const view = buffer.subarray(0, bytesRead);
    return {
      data: view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
    };
  }
}

const fileArg = process.argv[2] ?? 'public/power.pmtiles';
const filePath = path.resolve(fileArg);

const handle = await open(filePath, 'r');
try {
  const source = new NodeFileSource(handle, filePath);
  const archive = new PMTiles(source);
  const metadata = await archive.getMetadata();

  const layerIds = new Map();
  if (metadata && typeof metadata === 'object') {
    const maybeVectorLayers = metadata.vector_layers;
    if (Array.isArray(maybeVectorLayers)) {
      for (const layer of maybeVectorLayers) {
        if (layer && typeof layer === 'object' && typeof layer.id === 'string') {
          layerIds.set(layer.id, layer);
        }
      }
    }

    const jsonValue = metadata.json;
    if (typeof jsonValue === 'string') {
      try {
        const parsed = JSON.parse(jsonValue);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.vector_layers)) {
          for (const layer of parsed.vector_layers) {
            if (layer && typeof layer === 'object' && typeof layer.id === 'string') {
              if (!layerIds.has(layer.id)) {
                layerIds.set(layer.id, layer);
              }
            }
          }
        }
      } catch (error) {
        console.error('Failed to parse metadata.json contents:', error);
      }
    }
  }

  if (!layerIds.size) {
    console.log('No vector layers found in metadata.');
    process.exit(0);
  }

  const records = Array.from(layerIds.values()).map((layer) => {
    const fields = layer.fields && typeof layer.fields === 'object'
      ? Object.entries(layer.fields).map(([key, value]) => ({ name: key, type: String(value) }))
      : [];

    return {
      id: layer.id,
      description: layer.description ?? null,
      fields,
      minzoom: layer.minzoom ?? null,
      maxzoom: layer.maxzoom ?? null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  console.log(JSON.stringify({ file: filePath, layers: records }, null, 2));
} finally {
  await handle.close();
}
