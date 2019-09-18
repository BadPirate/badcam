import React from 'react';
import { Alert, Container, Table } from 'react-bootstrap';
import { FolderComponent } from './FolderComponent';

/** @typedef {typeof import('dropbox')} Dropbox*/

export class VideoComponent extends React.Component {
  state={
    message: "Loading...",
    variant: "info",
    folders: null,
  }

  render() {
    let message = this.state.message
    let variant = this.state.variant
    let folders = this.state.folders
    let box = this.props.box

    return (
      <Container>
        { message ? <Alert variant={variant}>{message}</Alert> : null }
        { folders ?
          <Table striped bordered>
            <thead>
              <tr>
                <th>Date</th>
                <th>Time</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
            {
              folders.entries.sort( (a,b) => {
                if (a.name > b.name) return 1
                if (b.name > a.name) return -1
                return 0
              }).map(folder => {
                return <FolderComponent key={folder.name} folder={folder} box={box}/>
              })
            }
            </tbody>
          </Table> : null
        }
      </Container>
    );
  }

  componentDidMount() {
    /** @param Dropbox box */
    let box = this.props.box

    box.filesListFolder({path: '/TeslaCam'})
    .then((result, error) => {
      if (error) {
        this.setState({
          message: "Error loading.",
          variant: "danger"
        })
      } else {
        this.setState({
          folders: result,
          message: null,
          variant: null
        })
      }
    })
  }
}