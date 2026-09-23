const nodemailer=require('nodemailer');

// Returns the configured Gmail SMTP transport without storing credentials in SQLite.
function transport() {
    const user=process.env.GMAIL_SMTP_USER || '';
    const pass=process.env.GMAIL_APP_PASSWORD || '';
    return user && pass ? nodemailer.createTransport({ service:'gmail',auth:{ user,pass } }) : null;
}

// Sends an account action link, or logs it only during local development when SMTP is absent.
async function sendAccountLink({ to,subject,heading,message,url }) {
    const sender=transport();
    if (!sender) {
        if (process.env.NODE_ENV !== 'production') console.info(`[CineVault mail preview] ${subject}: ${url}`);
        else throw new Error('Gmail SMTP is not configured');
        return { preview:true,accepted:[],rejected:[] };
    }
    const result=await sender.sendMail({ from:`CineVault <${process.env.GMAIL_SMTP_USER}>`,to,subject,
        text:`${heading}\n\n${message}\n\n${url}\n\nIf you did not request this, you can ignore this message.`,
        html:`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#221b15"><h1 style="color:#b76d2d">${heading}</h1><p>${message}</p><p><a href="${url}" style="display:inline-block;padding:12px 18px;border-radius:8px;background:#b76d2d;color:white;text-decoration:none;font-weight:700">Continue to CineVault</a></p><p style="font-size:12px;color:#6d625a">If you did not request this, you can ignore this message.</p></div>`,
    });
    const accepted=(result.accepted || []).map((value) => String(value).toLowerCase());
    const rejected=(result.rejected || []).map((value) => String(value).toLowerCase());
    if (!accepted.includes(String(to).toLowerCase()) || rejected.includes(String(to).toLowerCase())) {
        const error=new Error('Gmail did not accept the invitation recipient'); error.code='EMAIL_RECIPIENT_REJECTED'; throw error;
    }
    return { preview:false,accepted,rejected,messageId:result.messageId || '',response:result.response || '' };
}

module.exports={ sendAccountLink };
