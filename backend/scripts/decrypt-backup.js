const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const { DatabaseSync }=require('node:sqlite');

// Decrypts and verifies an encrypted off-device backup into a new SQLite file.
function decryptBackup() {
    const source=process.argv[2] ? path.resolve(process.argv[2]) : '';
    const destination=process.argv[3] ? path.resolve(process.argv[3]) : '';
    const passphrase=process.env.BACKUP_ENCRYPTION_PASSPHRASE || '';
    if (!source || !fs.existsSync(source)) throw new Error('Provide an existing .cvbackup source path');
    if (!destination || path.extname(destination).toLowerCase() !== '.sqlite') throw new Error('Provide a new destination path ending in .sqlite');
    if (fs.existsSync(destination)) throw new Error('The destination already exists');
    if (!passphrase) throw new Error('BACKUP_ENCRYPTION_PASSPHRASE is required');

    const envelope=fs.readFileSync(source);
    if (envelope.subarray(0,10).toString() !== 'CINEVAULT1') throw new Error('Unsupported encrypted backup format');
    const salt=envelope.subarray(10,26);
    const iv=envelope.subarray(26,38);
    const tag=envelope.subarray(38,54);
    const ciphertext=envelope.subarray(54);
    const key=crypto.scryptSync(passphrase,salt,32);
    const decipher=crypto.createDecipheriv('aes-256-gcm',key,iv);
    decipher.setAuthTag(tag);
    const plaintext=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    fs.writeFileSync(destination,plaintext,{ flag:'wx',mode:0o600 });
    try {
        const verification=new DatabaseSync(destination,{ readOnly:true });
        const integrity=verification.prepare('PRAGMA integrity_check').get().integrity_check;
        verification.close();
        if (integrity !== 'ok') throw new Error(`Backup integrity check returned: ${integrity}`);
    } catch(error) {
        fs.unlinkSync(destination);
        throw error;
    }
    console.log(`Decrypted and verified backup: ${destination}`);
}

decryptBackup();
