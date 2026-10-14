/** Display provider paragraphs/emphasis without extracting venue facts or interpreting HTML. */
export default function GroundedText({ text }: { text: string }) {
  return <div className="aide-grounded-text">{text.split(/\n\s*\n/).map((paragraph, index) => <p key={index}>
    {paragraph.split(/(\*\*[^*]+\*\*)/g).map((part, offset) => part.startsWith('**') && part.endsWith('**')
      ? <strong key={offset}>{part.slice(2, -2)}</strong> : part)}
  </p>)}</div>;
}
