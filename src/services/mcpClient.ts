import { ActionPermission } from '../types';
import { apiUrl } from '../config/env';

export interface MCPExecutionRequest {
  software: 'Legal Flow' | 'Compta Flow' | 'RECO';
  toolName: string;
  arguments: Record<string, any>;
  permissionLevel: ActionPermission;
}

export interface MCPExecutionResult {
  success: boolean;
  software: string;
  toolName: string;
  data?: any;
  error?: string;
  executionTimeMs: number;
  degraded?: boolean;
}

/**
 * Client MCP réel : passe par le proxy backend /api/mcp/call.
 * Le MCP_TOKEN et les URLs *_MCP_URL restent côté serveur.
 * Si le backend n'est pas configuré, on retourne une dégradation explicite
 * (jamais un faux SYNCHRONIZED).
 */
export async function executeSoftwareTool(
  request: MCPExecutionRequest
): Promise<MCPExecutionResult> {
  const startTime = Date.now();

  if (request.permissionLevel === 'EXECUTE') {
    const args = request.arguments || {};
    if (!(args.draftId && args.confirm === true)) {
      return {
        success: false,
        software: request.software,
        toolName: request.toolName,
        error: 'EXECUTE refusé : confirmation explicite requise (draftId + confirm:true).',
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  try {
    const res = await fetch(apiUrl('/mcp/call'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    const executionTimeMs = Date.now() - startTime;
    const json = await res.json().catch(() => ({}));

    if (res.status === 404) {
      return {
        success: false,
        software: request.software,
        toolName: request.toolName,
        error: 'backend_mcp_absent (dev sans émulateur). Lance firebase emulators:start ou déploie functions.',
        executionTimeMs,
        degraded: true,
      };
    }
    if (!res.ok || (json as any)?.error) {
      return {
        success: false,
        software: request.software,
        toolName: request.toolName,
        error: String((json as any)?.detail || (json as any)?.error || `backend_${res.status}`),
        executionTimeMs,
        degraded: (json as any)?.error === 'backend_not_configured',
      };
    }
    return {
      success: Boolean((json as any)?.ok ?? true),
      software: request.software,
      toolName: request.toolName,
      data: (json as any)?.response ?? json,
      executionTimeMs,
    };
  } catch {
    return {
      success: false,
      software: request.software,
      toolName: request.toolName,
      error: 'backend_unreachable : impossible de joindre /api/mcp/call.',
      executionTimeMs: Date.now() - startTime,
      degraded: true,
    };
  }
}
