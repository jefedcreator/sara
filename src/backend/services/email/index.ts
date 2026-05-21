import { Resend } from 'resend';
// import InviteEmail from './templates/InviteNotification';

class EmailService {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(process.env.RESEND_API_KEY);
  }

  async sendInviteEmail({
    to,
    invitedByUsername,
    invitedByEmail,
    entityName,
    entityType,
    inviteLink,
    invitedUserAvatar,
  }: {
    to: string;
    invitedByUsername: string | null;
    invitedByEmail: string | null;
    entityName: string;
    entityType: 'leaderboard' | 'club';
    inviteLink: string;
    invitedUserAvatar: string | null;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <invites@usestrive.run>',
        to,
        subject: `You've been invited to join ${entityName} on Strive`,
        react: null
        // react: InviteEmail({
        //   invitedByUsername: invitedByUsername ?? undefined,
        //   invitedByEmail: invitedByEmail ?? undefined,
        //   entityName,
        //   entityType,
        //   inviteLink,
        //   invitedUserAvatar: invitedUserAvatar ?? undefined,
        // }),
      });

      if (error) {
        console.error('Error sending invite email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending invite email:', error);
      return { success: false, error };
    }
  }
}

export const emailService = new EmailService();
