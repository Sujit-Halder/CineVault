const nodemailer=require('nodemailer');

// Returns the configured Gmail SMTP transport without storing credentials in SQLite.
function transport() {
    const user=process.env.GMAIL_SMTP_USER || '';
    const pass=process.env.GMAIL_APP_PASSWORD || '';
    return user && pass ? nodemailer.createTransport({ service:'gmail',auth:{ user,pass } }) : null;
}

// Sends one transactional email and verifies that the provider accepted its recipient.
async function deliver({ to,subject,text,html }) {
    const sender=transport();
    if (!sender) {
        if (process.env.NODE_ENV !== 'production') console.info(`[CineVault mail preview] ${subject}: ${text}`);
        else throw new Error('Gmail SMTP is not configured');
        return { preview:true,accepted:[],rejected:[] };
    }
    const result=await sender.sendMail({ from:`CineVault <${process.env.GMAIL_SMTP_USER}>`,to,subject,text,html });
    const accepted=(result.accepted || []).map((value) => String(value).toLowerCase());
    const rejected=(result.rejected || []).map((value) => String(value).toLowerCase());
    if (!accepted.includes(String(to).toLowerCase()) || rejected.includes(String(to).toLowerCase())) {
        const error=new Error('The mail provider did not accept the recipient address'); error.code='EMAIL_RECIPIENT_REJECTED'; throw error;
    }
    return { preview:false,accepted,rejected,messageId:result.messageId || '',response:result.response || '' };
}

// Sends an account action link, or logs it only during local development when SMTP is absent.
async function sendAccountLink({ to,subject,heading,message,url }) {
    return deliver({ to,subject,
        text:`${heading}\n\n${message}\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
        html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#221b15"><h1 style="color:#b76d2d">${heading}</h1><p>${message}</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#b76d2d;color:white;text-decoration:none;font-weight:700">Continue to CineVault</a></p><p style="font-size:12px;color:#6d625a">If you did not request this, you can ignore this message.</p></div>`,
    });
}

// Sends a short-lived mailbox verification code.
function sendAccountCode({ to,subject,heading,code,minutes=10 }) {
    return deliver({ to,subject,text:`${heading}\n\nYour verification code is: ${code}\n\nIt expires in ${minutes} minutes. If you did not request this, ignore this message.`,
        html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#221b15"><h1 style="color:#b76d2d">${heading}</h1><p>Your verification code is:</p><p style="font-size:30px;font-weight:800;letter-spacing:8px">${code}</p><p>This code expires in ${minutes} minutes. If you did not request this, ignore this message.</p></div>` });
}

// Sends a plain account-security notification.
function sendAccountNotice({ to,subject,heading,message }) {
    return deliver({ to,subject,text:`${heading}\n\n${message}`,html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#221b15"><h1 style="color:#b76d2d">${heading}</h1><p>${message}</p></div>` });
}

module.exports={ sendAccountLink,sendAccountCode,sendAccountNotice };
