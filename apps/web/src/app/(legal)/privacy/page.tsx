import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy notice' };

// Template aligned with India's DPDP Act 2023 / Rules 2025. The operator must fill in contact details
// and have it reviewed before a public launch (docs/PLAN.md §9.5).
export default function PrivacyPage() {
  return (
    <>
      <h1>Privacy notice</h1>
      <p className="text-muted-foreground">
        Version 2026-11-09 · Template: the operator of this instance must review it.
      </p>
      <h2>What we collect</h2>
      <ul>
        <li>Account: your sign-in email and a user ID from Firebase Authentication.</li>
        <li>Portfolio: the holdings, transactions and prices you enter or import.</li>
        <li>
          Usage metadata: sign-up date, last active date and counts of sign-ins and refreshes.
        </li>
      </ul>
      <h2>Why</h2>
      <p>Only to show you your portfolio and, if you opt in, to email you a summary.</p>
      <h2>What we never do</h2>
      <ul>
        <li>Ask for or store your broker password.</li>
        <li>Keep files you upload: they are read in memory and discarded.</li>
        <li>Sell or share your data. Price providers only ever receive instrument symbols.</li>
        <li>Show your holdings to administrators. Admins see only the usage metadata above.</li>
      </ul>
      <h2>Your rights</h2>
      <p>
        You can withdraw consent, correct your data, export it and delete your account at any time
        from Settings. Export and deletion arrive with the admin and privacy release.
      </p>
      <h2>Who can access the infrastructure</h2>
      <p>
        The operator of this Kosh instance controls its Firebase project and could technically
        access the database. If that matters to you, self-host Kosh.
      </p>
      <h2>Grievances</h2>
      <p>Contact the operator of this instance. Operators: publish a grievance contact here.</p>
    </>
  );
}
