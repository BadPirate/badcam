export default (req, res) => {
  let { query: { challenge }} = req
  res.setHeader('Content-Type','text/plain')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.status(200).text(challenge)
}