import React from 'react'
import { Card, Button, Alert, Col, Row } from 'react-bootstrap'
import { Dropbox } from 'dropbox'
import queryString from 'query-string'

// Configure Dropbox
let access = queryString.parse(window.location.hash).access_token
if (access) {
  localStorage.setItem('access',access)
} else {
  access = localStorage.getItem('access')
}
let config = { clientId: process.env.REACT_APP_DROPBOX_CLIENT_ID }
if (access) {
  config.accessToken = access
}
let box = new Dropbox(config);

class App extends React.Component {
  state={
    account: null
  }

  render() {
    let account = this.state.account
    return (
      <Card>
        <Card.Header>
          <Col>
            <Row>
              <h5>BadCam</h5>
              {
                account ?
                <Button className="ml-auto" variant="secondary" onClick={_ => {
                  localStorage.removeItem('access')
                  let location = window.location
                  location.href = `${location.protocol}//${location.host}`
                }}>
                  Logout { account.name.display_name }
                </Button> : null
              }
            </Row>
          </Col>
        </Card.Header>
        <Card.Body>
        {
          account ?
          <Alert variant="info">{JSON.stringify(account)}</Alert> :
          (access ?
          <Alert variant="info">Accessing Dropbox...</Alert>:
          <Button href={box.getAuthenticationUrl(`${window.location.href}redirect`)}>
            Login Dropbox
          </Button>)
        }
        </Card.Body>
      </Card>
    )
  }

  componentDidMount() {
    let account = this.state.account

    if (!account && access) {
      box.usersGetCurrentAccount().then(result => {
        this.setState({
          account: result
        })
      })
    }
  }
}

export default App;
