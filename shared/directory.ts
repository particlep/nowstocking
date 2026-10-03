// Who the signed-in user is and which warehouses they can open. Shared by the Worker and the app.

export type Role = 'owner' | 'admin' | 'member';

export interface WarehouseInfo {
  id: string;
  name: string;
}

export interface AccountInfo {
  id: string;
  name: string;
  role: Role;
  warehouses: WarehouseInfo[];
}

export interface MeResponse {
  user: { id: string; email: string };
  accounts: AccountInfo[];
  /** The service operator: sees the admin page. */
  operator?: boolean;
  /** The terms changed since this user last accepted them (email sign-in only). */
  terms_required?: boolean;
}

/** Warehouse ids appear in label URLs: /w/<id>/loc/B03. */
export const WAREHOUSE_ID = /^[a-z0-9]{10}$/;

export const canManage = (role: Role) => role === 'owner' || role === 'admin';
