// Email a label PDF through Cloudflare Email Sending.

const MAX_PDF_BYTES = 10 * 1024 * 1024;
const EMAIL_RE = /^[^\s@<>(),;:"\[\]]+@[^\s@<>(),;:"\[\]]+\.[a-z]{2,}$/i;

export class EmailError extends Error {
  constructor(message: string, readonly status: 400 | 502 = 400) {
    super(message);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export async function emailLabels(env: Env, form: FormData, user: string): Promise<{ messageId: string; to: string }> {
  const to = String(form.get('to') ?? '').trim();
  const file = form.get('file');
  const summary = String(form.get('summary') ?? '').trim().slice(0, 200);
  if (!EMAIL_RE.test(to)) throw new EmailError('Enter a valid email address.');
  if (!(file instanceof File) || file.type !== 'application/pdf') throw new EmailError('Missing PDF.');
  if (!file.size || file.size > MAX_PDF_BYTES) throw new EmailError('The PDF is empty or too large to email.');
  const name = /^[\w.-]{1,80}\.pdf$/.test(file.name) ? file.name : 'labels.pdf';

  const lines = [
    `Your QR labels are attached (${name}).`,
    summary && `Labels: ${summary}.`,
    '',
    'Print at 100% / Actual size, with "fit to page" turned off.',
    'Hold a test print against a label sheet up to the light before using real labels.',
    '',
    `Sent from NowStocking by ${user}.`,
  ].filter((l) => l !== '');

  try {
    const result = await env.EMAIL.send({
      to,
      from: { email: env.EMAIL_FROM, name: 'NowStocking' },
      subject: `Labels to print${summary ? `: ${summary}` : ''}`,
      text: lines.join('\n'),
      html: lines.map((l) => `<p style="margin:0 0 10px">${escapeHtml(l)}</p>`).join(''),
      attachments: [{ content: await file.arrayBuffer(), filename: name, type: 'application/pdf', disposition: 'attachment' }],
    });
    return { messageId: result.messageId, to };
  } catch (e) {
    console.error('email send failed', e);
    throw new EmailError(`The email couldn't be sent: ${e instanceof Error ? e.message : String(e)}`, 502);
  }
}
