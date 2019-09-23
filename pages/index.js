import React from 'react'
import { Card, Button, Col, Row } from 'react-bootstrap'
import { Dropbox } from 'dropbox'
import { VideoComponent } from '../components/VideoComponent';
import 'bootstrap-css-only/css/bootstrap.min.css'

class App extends React.Component {
  static async getInitialProps(ctx) {
    return {
      config: {
        clientId: process.env.REACT_APP_DROPBOX_CLIENT_ID,
      }
    }
  }

  state={
    account: null,
  }
  
  box=null

  render() {
    let box = this.box
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
          <VideoComponent account={account} box={box} account={account}/> :
          (box ? <Button href={box.getAuthenticationUrl(`${window.location.href}`)}>
            Login Dropbox
          </Button> : null )
        }
        </Card.Body>
      </Card>
    )
  }

  componentDidMount() {
    let account = this.state.account
    var token = null
    let search = window.location.href.match(/\#access_token\=([^&]*)/)
    if (search) {
      token = search[1]
      console.log("token",token) 
    } else {
      console.log("No token",window.location.href)
    }

    if (!this.box) {
      let config = this.props.config
      this.box = new Dropbox(config);
      this.forceUpdate()

      if (token) {
        localStorage.setItem('access',token)
        config.token = token
      } else {
        token = localStorage.getItem('access')
      }
      if (!account && token) {
        config.accessToken = token
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
