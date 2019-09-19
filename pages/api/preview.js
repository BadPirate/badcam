export default (req, res) => {
  let {
    body: { p },
    headers: { token }
  } = req

  res.setHeader('Content-Type', 'application/json')  
  res.statusCode = 200
  res.json({
    token: token,
    path: p,
  })
}
