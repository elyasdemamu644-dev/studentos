// Notification → email rendering. Deliberately tiny and static (no user input
// reaches the subject unguarded), so the only untrusted surface left is the
// data a user already sees in-app.

export interface NotificationEmailContent {
  subject: string;
  text: string;
}

export function renderNotificationEmail(notification: {
  title: string;
  message: string;
}): NotificationEmailContent {
  return {
    subject: `[Tutor Walle] ${notification.title}`,
    text: [notification.title, "", notification.message, "", "— Tutor Walle"].join("\n"),
  };
}