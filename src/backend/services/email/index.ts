import { Resend } from 'resend';
import ClubMilestoneNotification from './templates/ClubMilestoneNotification';
import InviteEmail from './templates/InviteNotification';
import LeaderboardEndNotification from './templates/LeaderboardEndNotification';
import ReAuthNotification from './templates/ReAuthNotification';
import RewardNotification from './templates/RewardNotification';
import WelcomeNotification from './templates/WelcomeNotification';
import type { RewardType } from '@prisma/client';

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
        react: InviteEmail({
          invitedByUsername: invitedByUsername ?? undefined,
          invitedByEmail: invitedByEmail ?? undefined,
          entityName,
          entityType,
          inviteLink,
          invitedUserAvatar: invitedUserAvatar ?? undefined,
        }),
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

  async sendWelcomeEmail(to: string, fullname: string) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <hello@usestrive.run>',
        to,
        subject: 'Welcome to Strive! 🚀',
        react: WelcomeNotification({ fullname }),
      });

      if (error) {
        console.error('Error sending welcome email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending welcome email:', error);
      return { success: false, error };
    }
  }

  async sendRewardEmail(
    to: string,
    badgeType: RewardType,
    leaderboardName: string,
    contextType: 'leaderboard' | 'challenge',
    badgeUrl?: string,
    rewardUrl?: string,
    metricText?: string
  ) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <hello@usestrive.run>',
        to,
        subject: `You won a ${badgeType} badge in ${leaderboardName}!`,
        react: RewardNotification({
          badgeType,
          leaderboardName,
          contextType,
          badgeUrl,
          rewardUrl,
          metricText,
        }),
      });

      if (error) {
        console.error('Error sending reward email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending reward email:', error);
      return { success: false, error };
    }
  }

  async sendClubMilestoneEmail(
    to: string,
    clubName: string,
    milestoneKm: number,
    clubSlug: string,
    badgeUrl?: string,
    rewardUrl?: string
  ) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <hello@usestrive.run>',
        to,
        subject: `Your club ${clubName} hit the ${milestoneKm}km milestone!`,
        react: ClubMilestoneNotification({
          clubName,
          milestoneKm,
          badgeUrl,
          rewardUrl,
          clubSlug,
        }),
      });

      if (error) {
        console.error('Error sending club milestone email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending club milestone email:', error);
      return { success: false, error };
    }
  }

  async sendReAuthEmail(to: string, provider: string, fullname: string) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <hello@usestrive.run>',
        to,
        subject: `Re-connect ${provider} to keep your runs syncing`,
        react: ReAuthNotification({ provider, fullname }),
      });

      if (error) {
        console.error('Error sending re-auth email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending re-auth email:', error);
      return { success: false, error };
    }
  }

  async sendLeaderboardEndEmail(
    to: string,
    leaderboardName: string,
    leaderboardId: string
  ) {
    try {
      const { data, error } = await this.resend.emails.send({
        from: 'Strive <hello@usestrive.run>',
        to,
        subject: `The ${leaderboardName} leaderboard has ended!`,
        react: LeaderboardEndNotification({ leaderboardName, leaderboardId }),
      });

      if (error) {
        console.error('Error sending leaderboard end email:', error);
        return { success: false, error };
      }

      return { success: true, data };
    } catch (error) {
      console.error('Unexpected error sending leaderboard end email:', error);
      return { success: false, error };
    }
  }
}

export const emailService = new EmailService();
