export interface InvitationEmailInput {
  toEmail: string;
  role: string;
  clinicName: string;
  organizationName: string | null;
  inviterName: string | null;
  expiresAt: string;
  link: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExpiry(expiresAt: string): string {
  try {
    return new Date(expiresAt).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return expiresAt;
  }
}

interface BuiltEmail {
  subject: string;
  text: string;
  html: string;
}

/**
 * Two deliberately distinct templates (never a shared "generic
 * invitation" body) so a recipient can immediately tell an independent-
 * clinic invitation apart from a multi-branch organization one, matching
 * the two invitation systems staying fully separate everywhere else in
 * this codebase. Neither includes patient, financial, or clinical data -
 * only what's already visible on the public /invite/[token] page itself
 * (clinic/organization name, role, expiry).
 */
export function buildIndependentInvitationEmail(
  input: InvitationEmailInput
): BuiltEmail {
  const { clinicName, role, inviterName, expiresAt, link } = input;

  const subject = `You've been invited to join ${clinicName} on DentalFlow`;

  const invitedByLine = inviterName ? `Invited by: ${inviterName}\n` : "";
  const invitedByHtml = inviterName
    ? `<p style="margin:0 0 8px;color:#475569;">Invited by: <strong>${escapeHtml(inviterName)}</strong></p>`
    : "";

  const text = `DentalFlow Invitation

Clinic: ${clinicName}

You have been invited to join ${clinicName} on DentalFlow.

Role: ${role}

${invitedByLine}This invitation expires on ${formatExpiry(expiresAt)}.

Accept your invitation:
${link}
`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px;">DentalFlow Invitation</h1>
  <p style="margin:0 0 8px;color:#475569;">Clinic: <strong>${escapeHtml(clinicName)}</strong></p>
  <p style="margin:0 0 16px;color:#334155;">
    You have been invited to join <strong>${escapeHtml(clinicName)}</strong> on DentalFlow.
  </p>
  <p style="margin:0 0 8px;color:#475569;">Role: <strong>${escapeHtml(role)}</strong></p>
  ${invitedByHtml}
  <p style="margin:16px 0;color:#64748b;font-size:14px;">
    This invitation expires on ${escapeHtml(formatExpiry(expiresAt))}.
  </p>
  <p style="margin:24px 0;">
    <a href="${link}" style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
      Accept Invitation
    </a>
  </p>
  <p style="margin:0;color:#94a3b8;font-size:12px;word-break:break-all;">${escapeHtml(link)}</p>
</div>
`;

  return { subject, text, html };
}

export function buildBranchInvitationEmail(
  input: InvitationEmailInput
): BuiltEmail {
  const { clinicName, organizationName, role, inviterName, expiresAt, link } =
    input;

  const orgName = organizationName ?? "your organization";

  const subject = `You've been invited to join ${clinicName} (${orgName}) on DentalFlow`;

  const invitedByLine = inviterName ? `Invited by: ${inviterName}\n` : "";
  const invitedByHtml = inviterName
    ? `<p style="margin:0 0 8px;color:#475569;">Invited by: <strong>${escapeHtml(inviterName)}</strong></p>`
    : "";

  const text = `DentalFlow Organization Invitation

Organization: ${orgName}

Branch: ${clinicName}

You have been invited to join ${clinicName} as a ${role}.

Organization: ${orgName}
Branch: ${clinicName}

${invitedByLine}This invitation expires on ${formatExpiry(expiresAt)}.

Accept your invitation:
${link}
`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
  <h1 style="font-size:20px;color:#0f172a;margin:0 0 16px;">DentalFlow Organization Invitation</h1>
  <p style="margin:0 0 8px;color:#475569;">Organization: <strong>${escapeHtml(orgName)}</strong></p>
  <p style="margin:0 0 16px;color:#475569;">Branch: <strong>${escapeHtml(clinicName)}</strong></p>
  <p style="margin:0 0 16px;color:#334155;">
    You have been invited to join <strong>${escapeHtml(clinicName)}</strong> as a <strong>${escapeHtml(role)}</strong>.
  </p>
  ${invitedByHtml}
  <p style="margin:16px 0;color:#64748b;font-size:14px;">
    This invitation expires on ${escapeHtml(formatExpiry(expiresAt))}.
  </p>
  <p style="margin:24px 0;">
    <a href="${link}" style="background:#2563eb;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
      Accept Invitation
    </a>
  </p>
  <p style="margin:0;color:#94a3b8;font-size:12px;word-break:break-all;">${escapeHtml(link)}</p>
</div>
`;

  return { subject, text, html };
}
