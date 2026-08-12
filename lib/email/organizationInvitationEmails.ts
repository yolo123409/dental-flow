interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function branchAccessLine(branchNames: string[]): string {
  return branchNames.length > 0 ? branchNames.join(", ") : "All Branches";
}

function wrapHtml(bodyHtml: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
      <h1 style="font-size: 20px; color: #0f766e; margin-bottom: 4px;">DentalFlow</h1>
      ${bodyHtml}
    </div>
  `.trim();
}

/** Scenario A - brand-new invitee, an account was pre-created with a temporary password. */
export function buildNewAccountInvitationEmail(input: {
  organizationName: string;
  role: string;
  branchNames: string[];
  email: string;
  temporaryPassword: string;
  loginUrl: string;
}): EmailContent {
  const branches = branchAccessLine(input.branchNames);

  const subject = `You've been invited to join ${input.organizationName}`;

  const html = wrapHtml(`
    <p>You've been invited to join <strong>${input.organizationName}</strong> on DentalFlow.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 4px 0; color: #6b7280;">Role</td><td style="padding: 4px 0; font-weight: 600;">${input.role}</td></tr>
      <tr><td style="padding: 4px 0; color: #6b7280;">Branch Access</td><td style="padding: 4px 0; font-weight: 600;">${branches}</td></tr>
    </table>
    <div style="background: #f8fafc; border-radius: 8px; padding: 16px; margin: 16px 0;">
      <p style="margin: 0 0 8px;"><strong>Your DentalFlow login</strong></p>
      <p style="margin: 0 0 4px; color: #6b7280;">Login Email</p>
      <p style="margin: 0 0 12px; font-weight: 600;">${input.email}</p>
      <p style="margin: 0 0 4px; color: #6b7280;">Temporary Password</p>
      <p style="margin: 0; font-weight: 600; font-family: monospace;">${input.temporaryPassword}</p>
    </div>
    <p><a href="${input.loginUrl}" style="display: inline-block; background: #0f766e; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Open DentalFlow</a></p>
    <p style="font-size: 13px; color: #6b7280;">For security, you will be required to change your password after your first login.</p>
  `);

  const text = [
    `You've been invited to join ${input.organizationName} on DentalFlow.`,
    ``,
    `Role: ${input.role}`,
    `Branch Access: ${branches}`,
    ``,
    `Your DentalFlow login:`,
    `Login Email: ${input.email}`,
    `Temporary Password: ${input.temporaryPassword}`,
    ``,
    `Login: ${input.loginUrl}`,
    ``,
    `You will be required to change your password after your first login.`,
  ].join("\n");

  return { subject, html, text };
}

/** Scenario B - the invited email already has a DentalFlow account. No password shown or changed. */
export function buildExistingAccountInvitationEmail(input: {
  organizationName: string;
  role: string;
  branchNames: string[];
  invitedByName: string | null;
  acceptUrl: string;
}): EmailContent {
  const branches = branchAccessLine(input.branchNames);

  const subject = `You've been invited to join ${input.organizationName} on DentalFlow`;

  const html = wrapHtml(`
    <p>You've been invited to join <strong>${input.organizationName}</strong> on DentalFlow.</p>
    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
      <tr><td style="padding: 4px 0; color: #6b7280;">Organization</td><td style="padding: 4px 0; font-weight: 600;">${input.organizationName}</td></tr>
      <tr><td style="padding: 4px 0; color: #6b7280;">Role</td><td style="padding: 4px 0; font-weight: 600;">${input.role}</td></tr>
      <tr><td style="padding: 4px 0; color: #6b7280;">Branch Access</td><td style="padding: 4px 0; font-weight: 600;">${branches}</td></tr>
      ${
        input.invitedByName
          ? `<tr><td style="padding: 4px 0; color: #6b7280;">Invited By</td><td style="padding: 4px 0; font-weight: 600;">${input.invitedByName}</td></tr>`
          : ""
      }
    </table>
    <p><a href="${input.acceptUrl}" style="display: inline-block; background: #0f766e; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none;">Accept Invitation</a></p>
    <p style="font-size: 13px; color: #6b7280;">Sign in with your existing DentalFlow credentials to accept - your password is not changing.</p>
  `);

  const text = [
    `You've been invited to join ${input.organizationName} on DentalFlow.`,
    ``,
    `Organization: ${input.organizationName}`,
    `Role: ${input.role}`,
    `Branch Access: ${branches}`,
    ...(input.invitedByName ? [`Invited By: ${input.invitedByName}`] : []),
    ``,
    `Accept Invitation: ${input.acceptUrl}`,
    ``,
    `Sign in with your existing DentalFlow credentials to accept - your password is not changing.`,
  ].join("\n");

  return { subject, html, text };
}
