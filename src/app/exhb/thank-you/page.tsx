import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Thank you · Celebrations of Deepam',
  description: 'Your visit to Celebrations of Deepam is registered.',
};

const MAP_LINK = 'https://maps.app.goo.gl/eabDBEZHVUNxALJi8';

export default function ExhibitionThankYouPage() {
  return <main className="[font-family:Helvetica,'Helvetica_Neue',Arial,sans-serif] flex flex-1 items-center bg-white px-5 py-16 text-center text-[#232323]">
    <div className="mx-auto w-full max-w-xl">
      <p className="text-3xl tracking-[0.12em] text-[#7f1835]">DEEPAM</p>
      <p className="mt-0.5 text-xs tracking-[0.2em] text-[#7f1835]">by ananta</p>
      <h1 className="mt-10 text-4xl font-semibold tracking-wide">Thank you</h1>
      <p className="mt-4 text-base leading-relaxed text-[#5c5c5c]">Your visit is registered. We look forward to welcoming you at Celebrations of Deepam.</p>
      <p className="mt-8 border-y border-black/15 py-5 text-sm uppercase leading-relaxed tracking-[0.12em] text-[#5c5c5c]">
        <strong className="font-semibold text-[#232323]">16 – 18 October</strong><br />Shubh Convention Centre, JP Nagar, Bengaluru
      </p>
      <a href={MAP_LINK} target="_blank" rel="noopener noreferrer" className="mt-8 inline-flex items-center justify-center rounded-full border border-[#7f1835] px-6 py-3 text-sm font-medium uppercase tracking-[0.18em] text-[#7f1835] hover:bg-[#7f1835] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7f1835]">Get directions</a>
    </div>
  </main>;
}
