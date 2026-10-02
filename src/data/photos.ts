// Part photos. Taking one needs a connection: the photo uploads first, then the item points at it.
import type { Item } from '../../shared/schema';
import { toJpeg } from '../lib/images';
import { api } from './api';
import { commit, updateOp } from './mutate';
import { wpath } from './workspace';

export const photoUrl = (key: string, size: 'full' | 'thumb') => wpath(`/photos/${key}/${size}`);

const upload = (key: string, size: 'full' | 'thumb', jpeg: Blob) =>
  api(wpath(`/photos/${key}/${size}`), { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: jpeg });

/** The old photo goes once the new one is in place. Best effort: a leftover file is harmless. */
export const discard = (key: string | null) => {
  if (key) void api(wpath(`/photos/${key}`), { method: 'DELETE' }).catch(() => {});
};

export async function setItemPhoto(item: Item, file: Blob) {
  if (!navigator.onLine) throw new Error('Adding a photo needs a connection.');
  const key = crypto.randomUUID();
  const [full, thumb] = await Promise.all([toJpeg(file, 1600, 0.85), toJpeg(file, 240, 0.8)]);
  await upload(key, 'full', full);
  await upload(key, 'thumb', thumb);
  const old = item.photo_key;
  await commit(`Photo of ${item.stock_code}`, [updateOp('items', item.id, { photo_key: key })]);
  discard(old);
}

export async function removeItemPhoto(item: Item) {
  const old = item.photo_key;
  await commit(`Remove photo of ${item.stock_code}`, [updateOp('items', item.id, { photo_key: null })]);
  discard(old);
}
