import fs from 'fs-extra';
import path from 'path';
import { normalizeRemoteUrl } from './mirror-utils.js';

const DEFAULT_METADATA = {
  createdBy: 'Codex',
  createdAt: new Date().toISOString(),
  note: 'Automatic multi-layer seed tracker.',
};

export class MultiLevelSeedManager {
  constructor(filePath) {
    this.filePath = filePath;
    this.config = {
      layers: [],
      entities: {},
      metadata: { ...DEFAULT_METADATA },
    };
    this.entities = new Map();
    this.dirty = false;
    this.load();
  }

  load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const disk = fs.readJsonSync(this.filePath);
        this.config = {
          ...this.config,
          ...disk,
          metadata: { ...this.config.metadata, ...(disk.metadata || {}) },
        };
        this.entities = new Map(Object.entries(this.config.entities || {}));
        return;
      } catch (error) {
        console.warn(`[SEED] Failed to read ${this.filePath}: ${error.message}`);
      }
    }
    fs.ensureDirSync(path.dirname(this.filePath));
    this.persistSync();
  }

  getLayerForUrl(url) {
    const candidates = this.config.layers || [];
    for (const layer of candidates) {
      const urls = Array.isArray(layer.urls) ? layer.urls : [];
      if (urls.includes(url)) {
        return { name: layer.name, level: layer.level };
      }
    }
    return null;
  }

  ensureEntity(rawUrl, { markSeed = false } = {}) {
    const normalized = normalizeRemoteUrl(rawUrl);
    if (!normalized) {
      return null;
    }

    if (!this.entities.has(normalized)) {
      this.entities.set(normalized, {
        url: normalized,
        status: 'pending',
        layer: null,
        children: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...(markSeed ? { seed: true } : {}),
      });
      this.dirty = true;
    }

    const entity = this.entities.get(normalized);
    const layerInfo = this.getLayerForUrl(normalized);
    if (layerInfo) {
      const existingLayer = entity.layer || {};
      if (entity.layer?.name !== layerInfo.name) {
        entity.layer = layerInfo;
        this.dirty = true;
      } else if (existingLayer.level !== layerInfo.level) {
        entity.layer = layerInfo;
        this.dirty = true;
      }
    }

    return entity;
  }

  async recordSeeds(seeds = []) {
    let changed = false;
    for (const seed of seeds) {
      const entity = this.ensureEntity(seed, { markSeed: true });
      if (entity) {
        changed = true;
      }
    }
    if (changed) {
      await this.persist();
    }
  }

  async markDownloaded(url, discovered = []) {
    const parent = this.ensureEntity(url);
    if (!parent) {
      return;
    }
    parent.status = 'downloaded';
    parent.updatedAt = new Date().toISOString();
    this.dirty = true;

    let touched = false;
    for (const childUrl of discovered) {
      const child = this.ensureEntity(childUrl);
      if (child && !parent.children.includes(child.url)) {
        parent.children.push(child.url);
        touched = true;
      }
    }

    if (touched) {
      parent.updatedAt = new Date().toISOString();
    }

    this.persist();
  }

  persistSync() {
    this.config.entities = Object.fromEntries(this.entities);
    this.config.metadata = { ...this.config.metadata, updatedAt: new Date().toISOString() };
    fs.writeJsonSync(this.filePath, this.config, { spaces: 2 });
    this.dirty = false;
  }

  async persist() {
    if (!this.dirty) {
      return;
    }
    this.config.entities = Object.fromEntries(this.entities);
    this.config.metadata = { ...this.config.metadata, updatedAt: new Date().toISOString() };
    await fs.writeJson(this.filePath, this.config, { spaces: 2 });
    this.dirty = false;
  }
}
