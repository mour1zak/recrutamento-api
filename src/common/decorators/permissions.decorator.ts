import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '../constants/permissions.constants.js';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Marca um endpoint com a(s) permission key(s) necessárias. Só decide "o
 * papel pode fazer isso" — escopo ("é da própria empresa"/"é o próprio
 * recurso") continua sendo checado no Service (RBAC dinâmico controla
 * capacidade, não escopo — decisão registrada em FASE-1-MODELAGEM.md).
 */
export const Permissions = (...permissions: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, permissions);
