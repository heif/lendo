// Optional profile photo: asked at signup (/welcome) and on profile edit. Shown in avatar circles.
import type { Env } from './env';

export async function saveUserPhoto(env: Env, uid: string, f: unknown): Promise<string | null> {
  if (!(f instanceof File) || !f.size || f.size > 30e6 || !/^image\//.test(f.type)) return null;
  const key = `users/${uid}/${crypto.randomUUID().slice(0, 8)}.${f.type.includes('png') ? 'png' : 'jpg'}`;
  await env.PHOTOS.put(key, await f.arrayBuffer(), { httpMetadata: { contentType: f.type } });
  const old = await env.DB.prepare('SELECT photo_key FROM users WHERE id = ?').bind(uid).first<{ photo_key: string | null }>().catch(() => null);
  await env.DB.prepare('UPDATE users SET photo_key = ? WHERE id = ?').bind(key, uid).run();
  if (old?.photo_key) await env.PHOTOS.delete(old.photo_key).catch(() => {});
  return key;
}

// circle with the photo, or the first letter
export const Avatar = (p: { name: string | null; photo?: string | null; size?: number; cls?: string }) => {
  const s = p.size || 40;
  const st = `width:${s}px;height:${s}px;border-radius:${s / 2}px;font-size:${Math.round(s * 0.42)}px`;
  return p.photo
    ? <img class={'uav ' + (p.cls || '')} src={'/p/' + p.photo} alt="" style={st + ';object-fit:cover'} />
    : <span class={'uav ' + (p.cls || '')} style={st}>{(p.name || 'N').trim().charAt(0).toUpperCase()}</span>;
};

// shrink to a 512px JPEG in the browser before upload (big iPhone photos / HEIC), and preview it
const PHOTO_JS = `window.lendoPhoto=window.lendoPhoto||function(inp){var f=inp.files[0];if(!f)return;var rd=new FileReader();rd.onload=function(){var im=new Image();im.onload=function(){var s=Math.min(1,512/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*s);c.height=Math.round(im.height*s);c.getContext('2d').drawImage(im,0,0,c.width,c.height);var d=c.toDataURL('image/jpeg',0.85);document.getElementById('pfPrev').innerHTML='<img class="uav" src="'+d+'" style="width:64px;height:64px;border-radius:32px;object-fit:cover">';c.toBlob(function(b){try{var dt=new DataTransfer();dt.items.add(new File([b],'me.jpg',{type:'image/jpeg'}));inp.files=dt.files}catch(e){}},'image/jpeg',0.85)};im.src=rd.result};rd.readAsDataURL(f)}`;

// the photo picker block used in forms (circle preview + file input)
export const PhotoField = (p: { name: string | null; photo?: string | null; label: string }) => (
  <label class="field photofield">
    <span>{p.label}</span>
    <div class="row" style="gap:12px;align-items:center">
      <span id="pfPrev"><Avatar name={p.name} photo={p.photo} size={64} /></span>
      <span class="btn sm" style="width:auto">{p.photo ? 'Change photo' : 'Add a photo'}</span>
      <input type="file" name="photo" accept="image/*" hidden onchange="lendoPhoto(this)" />
      <script dangerouslySetInnerHTML={{ __html: PHOTO_JS }} />
    </div>
  </label>
);
