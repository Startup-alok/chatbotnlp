# TODO: Fix Admission Response Inaccuracy

## Steps to Complete
- [x] Add new response key 'admission_start' in the responses object in app.js with value "Admissions start from June to August."
- [x] Update the admission rule in the /ask endpoint in app.js to check if userInput includes "when" or "kab", then use 'admission_start' response; otherwise, use the existing 'admission' response.
- [x] Test the bot by running the server and querying "when do the admission starts" and "how to apply" to ensure correct responses.
