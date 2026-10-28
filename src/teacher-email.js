const nodemailer = require("nodemailer");

function createTeacherCodeSender(env = process.env, createTransport = nodemailer.createTransport) {
  const host = env.TEACHER_SMTP_HOST?.trim();
  const port = Number(env.TEACHER_SMTP_PORT);
  const from = env.TEACHER_EMAIL_FROM?.trim();
  const secure = env.TEACHER_SMTP_SECURE === "true";
  const username = env.TEACHER_SMTP_USERNAME;
  const password = env.TEACHER_SMTP_PASSWORD;

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !from ||
      Boolean(username) !== Boolean(password)) {
    return null;
  }

  const transport = createTransport({
    host,
    port,
    secure,
    requireTLS: !secure,
    ...(username && password ? { auth: { user: username, pass: password } } : {}),
  });

  return async function sendTeacherCode({ to, username: accountName, code, institutionName }) {
    const result = await transport.sendMail({
      from,
      to,
      subject: "Your zachs-quiz teacher signup code",
      text: [
        `Your one-time teacher signup code for ${institutionName} is:`,
        "",
        code,
        "",
        `Username: ${accountName}`,
        "",
        "Enter this code on the teacher application page to create your account.",
        "If you did not request this code, you can ignore this message.",
      ].join("\n"),
    });
    const accepted = Array.isArray(result.accepted) ? result.accepted : [];
    const rejected = Array.isArray(result.rejected) ? result.rejected : [];
    const acceptedRecipient = accepted.some((address) =>
      String(address).toLowerCase() === to.toLowerCase());
    const rejectedRecipient = rejected.some((address) =>
      String(address).toLowerCase() === to.toLowerCase());
    if (rejectedRecipient || !acceptedRecipient) {
      throw new Error("SMTP server did not accept the teacher application recipient");
    }
  };
}

module.exports = { createTeacherCodeSender };
