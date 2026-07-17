# Setting up cross-device sync

This connects the app to your own free Firebase project so your cards, reviews, and settings sync in real time between your phone and laptop. It takes about 5 minutes, is free at this scale (Firestore's free tier is 50k reads / 20k writes per day — far more than one person reviewing flashcards will ever use), and nobody but you can read your data.

## 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `tspsc-revise`), and finish the wizard (you can disable Google Analytics for this project — not needed).

## 2. Enable Email/Password sign-in

1. In the left sidebar, go to **Build → Authentication**.
2. Click **Get started**.
3. Under "Sign-in method," click **Email/Password**, toggle it **Enabled**, and save.

## 3. Create a Firestore database

1. In the left sidebar, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Choose any region close to you.
4. Start in **production mode** (not test mode — the security rules below handle access control properly, so you don't want the database wide open even temporarily).

## 4. Set security rules

Still in Firestore, go to the **Rules** tab and replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**. This restricts every document to only the signed-in user who owns it — nobody else can read or write your data, including other users of the same Firebase project if you ever add any.

## 5. Get your web app config

1. Go to **Project settings** (the gear icon next to "Project Overview").
2. Scroll to "Your apps" and click the **</>** (web) icon to register a new web app.
3. Give it any nickname, skip Firebase Hosting (not needed — you're already hosting on GitHub Pages).
4. It'll show you a `firebaseConfig` object that looks like:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "tspsc-revise.firebaseapp.com",
  projectId: "tspsc-revise",
  storageBucket: "tspsc-revise.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Copy just the `{ ... }` object (everything between the curly braces, including them).

## 6. Paste it into the app

1. Open the app → **Settings** → scroll to **Sync across devices**.
2. Paste the config object into the "Firebase config" box and click **Save Config**.
3. An email/password sign-up form appears. Pick any email and password (this doesn't need to be a real inbox — it's just how Firebase identifies "you" across devices) and click **Sign Up**.
4. Repeat steps on your other device: Settings → paste the same config → **Sign In** (not Sign Up this time) with the same email/password.

Once both devices are signed in, edits sync automatically within a second or two whenever you're online — no manual export/import needed. The Backup export/import buttons still work independently if you ever want a manual snapshot.

## Notes

- This uses Firebase's `apiKey` in the config, which is safe to expose client-side (it's not a secret — Firebase's security model relies on the Firestore rules above, not on hiding the key).
- If sync shows an error, check: did you publish the security rules exactly as above, and is Email/Password sign-in actually enabled in step 2?
- To stop syncing on a device, go to Settings and click **Sign Out** — its local data stays intact, it just stops pushing/pulling.
