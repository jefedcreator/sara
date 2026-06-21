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

  async sendBookingConfirmationEmail({
    to,
    businessName,
    serviceName,
    startTime,
  }: {
    to: string;
    businessName: string;
    serviceName: string;
    startTime: Date;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Sara <bookings@sara.app>',
        to,
        subject: `Your booking with ${businessName} is confirmed`,
        html: `<p>Your appointment for <strong>${serviceName}</strong> with ${businessName} on ${startTime.toLocaleString()} is confirmed.</p>`,
      });

      if (error) {
        console.error('Error sending booking confirmation email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending booking confirmation email:', error);
      return { success: false, error };
    }
  }

  async sendBookingCancellationEmail({
    to,
    businessName,
    serviceName,
    startTime,
  }: {
    to: string;
    businessName: string;
    serviceName: string;
    startTime: Date;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Sara <bookings@sara.app>',
        to,
        subject: `Your booking with ${businessName} has been cancelled`,
        html: `<p>Your appointment for <strong>${serviceName}</strong> with ${businessName} on ${startTime.toLocaleString()} has been cancelled.</p>`,
      });

      if (error) {
        console.error('Error sending booking cancellation email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending booking cancellation email:', error);
      return { success: false, error };
    }
  }

  async sendBookingRescheduledEmail({
    to,
    businessName,
    serviceName,
    previousStartTime,
    newStartTime,
  }: {
    to: string;
    businessName: string;
    serviceName: string;
    previousStartTime: Date;
    newStartTime: Date;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Sara <bookings@sara.app>',
        to,
        subject: `Your booking with ${businessName} has been rescheduled`,
        html: `<p>Your appointment for <strong>${serviceName}</strong> with ${businessName} has been moved from ${previousStartTime.toLocaleString()} to ${newStartTime.toLocaleString()}.</p>`,
      });

      if (error) {
        console.error('Error sending booking rescheduled email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending booking rescheduled email:', error);
      return { success: false, error };
    }
  }

  async sendBookingReminderEmail({
    to,
    businessName,
    serviceName,
    startTime,
  }: {
    to: string;
    businessName: string;
    serviceName: string;
    startTime: Date;
  }) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Sara <bookings@sara.app>',
        to,
        subject: `Reminder: your booking with ${businessName} is tomorrow`,
        html: `<p>This is a reminder that your appointment for <strong>${serviceName}</strong> with ${businessName} is on ${startTime.toLocaleString()}.</p>`,
      });

      if (error) {
        console.error('Error sending booking reminder email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending booking reminder email:', error);
      return { success: false, error };
    }
  }
}

export const emailService = new EmailService();
