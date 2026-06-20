---
name: ssh-vps
description: connect to vps.
disable-model-invocation: true
---

# Connect Vps Skill

Connect vps for the first time.

## Work flow

1. Read packages/infra/vps-info.md to know what are already connected.
   Prompt user what environment they are setting up for: dev or prod.
   Warn user if they try to set up env already set up.

2.Ask user for the following information:

- Project name
- Deployment environment (dev or prod)
- VPS ip, user
- Domain name if possible
- what command cli user use (cmd, powershell, bash...)

3. Give user command & ask them to run it to set up key login for root user in vps:

- Use id_rsa.pub or generate if not existed.

4. Inside vps, create a deploy user as passwordless sudo. Then copy local ~/.ssh/id_rsa.pub into vps and set it up for deploy user.
5. In local, modify the ~/.ssh/config file to add an entry for the vps so we can ssh into it without password in the future. The entry should look like this:

```Host {project_name}-vps
  HostName {vps_ip}
  User {vps_user}
  IdentityFile ~/.ssh/id_rsa
```

6. Inside vps, generate a new ssh key pair for github. Present the public key to user and ask them to add it to deployment key of the repository.
7. After user confirms that the key is added, test the connection to github.
8. Make sure ssh using alias & deploy user is working before hardening ssh.
9. HARDEN SSH

   Must check and update **all** of the following (not just the main file).

- `/etc/ssh/sshd_config`
- `/etc/ssh/sshd_config.d/*.conf`

**Required configuration:**

```
PermitRootLogin              no
PasswordAuthentication       no
PubkeyAuthentication         yes
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitEmptyPasswords         no
```

**After editing:**

```bash
sudo sshd -t                                          # validate config first
sudo systemctl restart ssh || sudo systemctl restart sshd
```

10. Write vps info into packages/infra/vps-info.md for future reference.

- ssh alias: {project_name}-{prod or dev}-vps
- domain: {domain_name}
- deployment environment: {prod or dev}
- password login disable: {true or false}
