import React from 'react'
import { Card, Button, Alert, Col, Row } from 'react-bootstrap'
import { Dropbox } from 'dropbox'
import queryString from 'query-string'
import { VideoComponent } from '../components/VideoComponent';
import 'bootstrap-css-only/css/bootstrap.min.css'

class App extends React.Component {
  state={
    account: null,
    loading: false
  }

  box=null

  render() {
    let account = this.state.account
    let loading = this.state.loading
    let box = this.box

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
          <VideoComponent account={account} box={box}/> :
          (loading ?
          <Alert variant="info">Accessing Dropbox...</Alert> :
          (box ? <Button href={box.getAuthenticationUrl(`${window.location.href}redirect`)}>
            Login Dropbox
          </Button> : null ))
        }
        </Card.Body>
      </Card>
    )
  }

  componentDidMount() {
    let account = this.state.account

    if (!this.box) {
      let config = { clientId: process.env.REACT_APP_DROPBOX_CLIENT_ID }
      this.box = new Dropbox(config);

      let access = queryString.parse(window.location.hash).access_token
      if (access) {
        localStorage.setItem('access',access)
        this.forceUpdate()
      } else {
        access = localStorage.getItem('access')
      }
      if (!account && access) {
        if (access) {
          config.accessToken = access
        }
        this.box = new Dropbox(config);
        this.setState({
          loading: true
        })
        this.box.usersGetCurrentAccount().then(result => {
          this.setState({
            account: result,
            loading: false
          })
        })
      }
    }
  }
}

export default App;
