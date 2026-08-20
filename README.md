# Lab 0 · Get set up

Two things: make your own copy of the workshop repo, then open Copilot CLI in it.

**You're done when:** the Copilot CLI prompt is open in your own repo and `/usage` responds.

---

## 1 · Create your own repo from the template (don't skip this step)

The labs create issues, label them and comment on them, so you need your own copy — not this one.

In your browser, sign in to github.com as the **private account provided at registration**, not your enterprise identity — whatever you create belongs to whoever is signed in. Then:

1. Open **[the workshop template](https://github.com/hackathon-pink-wolf-47/context-and-token-optimization/generate)**.
2. Owner **hackathon-pink-wolf-47**, name it after your username, then **Create repository**.

Page 404s or the owner list is empty? You are signed in as the wrong account, or your org invite is still pending — check your registration email, or raise a hand.

Now open Copilot CLI in it — pick one:

- **Copilot CLI installed on your machine?** → [Section 2](#2--local-copilot-cli)
- **Forgot to install it, no Node 22, or your machine won't allow it?** → [Section 3](#3--github-codespaces-nothing-to-install-locally)

## 2 · Local Copilot CLI

Your shell needs the workshop account too — `gh auth status` must show it, otherwise `gh auth login`. When you run `gh auth login`, sign in with the GitHub username that was invited to the hackathon org.

No `gh` yet? Install it — or just ask Copilot to do it for you:

| OS | Command |
| --- | --- |
| macOS | `brew install gh` |
| Windows | `winget install --id GitHub.cli` |

Then clone the repo you just created and step into it:

```bash
gh repo clone hackathon-purple-horse-4/<your-repo-name>

cd <your-repo-name>
copilot
```

Once the prompt is open, make sure you're on the latest version:

```
/update
```

**Use the right account.** Today runs on the **personal github.com account you provided at registration**. Inside Copilot CLI:

```
/logout
/login
```

Follow the device-code flow in the browser and sign in with personal account that was invited to the hackathon org. Check `/usage` responds — done. Continue to [Lab 1](lab/1-size-limit-record.md).

## 3 · GitHub Codespaces (nothing to install locally)

On the page of the repo you created in step 1: green **Code** button → **Codespaces** tab → **Create codespace on main**.

<img src="https://docs.github.com/assets/cb-49943/mw-1440/images/help/codespaces/who-will-pay.webp" alt="Code → Codespaces → Create codespace on main" width="25%">

Wait for the container to build (~2 min). Then, in the codespace terminal, install the latest Copilot CLI and start it:

```bash
curl -fsSL https://gh.io/copilot-install | sudo bash
copilot
```

The codespace already runs as your private account — no login needed. Check `/usage` responds, then `/exit` — done. Continue to [Lab 1](lab/1-size-limit-record.md).

