// #4 マルチリポ: 案件(ワークスペース)が抱える対象リポジトリの登録
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from '../config.js';
import type { Repo } from '../types.js';

class RepoStore {
  private repos = new Map<string, Repo>();

  constructor() {
    // 既定案件に、CORRAL_REPO を1つ登録
    const def: Repo = {
      id: 'repo-default',
      name: path.basename(config.repoRoot) || 'default',
      path: config.repoRoot,
      workspaceId: 'default',
    };
    this.repos.set(def.id, def);

    // CORRAL_REPOS='[{"name":"web","path":"/a","workspaceId":"default"}]' で追加登録
    try {
      const extra = JSON.parse(process.env.CORRAL_REPOS ?? '[]') as Array<Partial<Repo>>;
      for (const r of extra) {
        if (r.path && r.workspaceId) {
          const repo: Repo = {
            id: r.id ?? nanoid(8),
            name: r.name ?? path.basename(r.path),
            path: r.path,
            workspaceId: r.workspaceId,
          };
          this.repos.set(repo.id, repo);
        }
      }
    } catch {
      /* ignore */
    }
  }

  listForWorkspace(workspaceId: string): Repo[] {
    return [...this.repos.values()].filter((r) => r.workspaceId === workspaceId);
  }

  get(id: string): Repo | undefined {
    return this.repos.get(id);
  }

  create(workspaceId: string, name: string, p: string): Repo {
    const repo: Repo = { id: nanoid(8), name, path: p, workspaceId };
    this.repos.set(repo.id, repo);
    return repo;
  }
}

export const repoStore = new RepoStore();
