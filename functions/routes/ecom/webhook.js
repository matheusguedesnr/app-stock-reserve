// read configured E-Com Plus app data
const getAppData = require('./../../lib/store-api/get-app-data')

const SKIP_TRIGGER_NAME = 'SkipTrigger'
const ECHO_SUCCESS = 'SUCCESS'
const ECHO_SKIP = 'SKIP'
const ECHO_API_ERROR = 'STORE_API_ERR'

exports.post = async ({ appSdk, admin }, req, res) => {
  // receiving notification from Store API
  const { storeId } = req

  /**
   * Treat E-Com Plus trigger body here
   * Ref.: https://developers.e-com.plus/docs/api/#/store/triggers/
   */
  const trigger = req.body
  appSdk.getAuth(storeId)
    .then((auth) => {
      return getAppData({ appSdk, storeId, auth })
        .then(appData => {
          if (
            Array.isArray(appData.ignore_triggers) &&
            appData.ignore_triggers.indexOf(trigger.resource) > -1
          ) {
            // ignore current trigger
            const err = new Error()
            err.name = SKIP_TRIGGER_NAME
            throw err
          }

          /* DO YOUR CUSTOM STUFF HERE */
          let docId, isCart
          console.log('Deu certo auth')
          if (trigger.action !== 'delete') {
            docId = trigger.resource_id || trigger.inserted_id
            isCart = trigger.resource === 'carts'
          }
          console.log(`> Webhook #${storeId} ${docId} [${trigger.resource}]`)
          // nothing to do
          if (docId && isCart) {
            const docEndpoint = `carts/${docId}.json`
            return appSdk.apiRequest(storeId, docEndpoint).then(async ({ response }) => {
              const doc = response.data
              const { completed } = doc
              if (completed || doc.available === false) {
                return res.sendStatus(204)
              }
              const documentRef = admin.firestore().doc(`cart_reserve/${docId}`)
              const documentSnapshot = await documentRef.get()
              const { data: { hits } } = await ecomClient.search({
                storeId,
                url: '/items.json',
                method: 'post',
                data: {
                  size: doc.items.length,
                  query: {
                    bool: {
                      must: [
                        { terms: { _id: doc.items.map((item) => item.product_id) } }
                      ]
                    }
                  }
                }
              })
              if (!documentSnapshot.exists) {
                for (let index = 0; index < doc.items.length; index++) {
                  const item = doc.items[index];
                  const hitProduct = hits.hits.find(({ _id }) => _id === item.product_id)
                  if (hitProduct) {
                    let endpoint = `/products/${item.product_id}`
                    let quantity
                    if (hitProduct._source && hitProduct._source.variations && hitProduct._source.variations.length) {
                      const variation = hitProduct._source.variations.find(({ _id }) => _id === item.variation_id)
                      endpoint += `/variations/${variation._id}`
                      endpoint += '/quantity.json' 
                      quantity = variation.quantity
                      quantity -= item.quantity
                      quantity >= 0 ? quantity : quantity = 0
                      console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                      await appSdk.apiRequest(storeId, endpoint, 'PUT', { quantity }, auth)
                    } else {
                      endpoint += '/quantity.json'
                      quantity = hitProduct._source && hitProduct._source.quantity || 0
                      quantity -= item.quantity
                      quantity >= 0 ? quantity : quantity = 0
                      await appSdk.apiRequest(storeId, endpoint, 'PUT', { quantity }, auth)
                    }
                  }
                }
                await documentRef.set({
                  storeId,
                  items: doc.items,
                  completed,
                  queuedAt: admin.firestore.Timestamp.now()
                })
                if (!res.headersSent) {
                  // done
                  return res.status(201).send(ECHO_SUCCESS)
                }
              } else {
                const { storeId, items, completed, queuedAt } = documentSnapshot.data()
                const diffItems = []
                doc.items.forEach(item => {
                  let quantityItem
                  items.forEach(itemDoc => {
                    if (item.product_id === itemDoc.product_id && item.variation_id === itemDoc.variation_id) {
                      quantityItem = (item.quantity - itemDoc.quantity) || 0
                      if (quantityItem !== 0) {
                        diffItems.push({
                          ...item,
                          quantity: quantityItem
                        })
                      }
                    }
                  }) 
                });

                if (diffItems.length) {
                  for (let index = 0; index < diffItems.length; index++) {
                    const item = diffItems[index];
                    const hitProduct = hits.hits.find(({ _id }) => _id === item.product_id)
                    if (hitProduct) {
                      let endpoint = `/products/${item.product_id}`
                      let quantity
                      if (hitProduct._source && hitProduct._source.variations && hitProduct._source.variations.length) {
                        const variation = hitProduct._source.variations.find(({ _id }) => _id === item.variation_id)
                        endpoint += `/variations/${variation._id}`
                        endpoint += '/quantity.json' 
                        quantity = variation.quantity
                        quantity -= item.quantity
                        quantity >= 0 ? quantity : quantity = 0
                        console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                        await appSdk.apiRequest(storeId, endpoint, 'PUT', { quantity }, auth)
                      } else {
                        endpoint += '/quantity.json'
                        quantity = hitProduct._source && hitProduct._source.quantity || 0
                        quantity -= item.quantity
                        quantity >= 0 ? quantity : quantity = 0
                        console.log(`#${storeId} - ${endpoint} - ${quantity}`)
                        await appSdk.apiRequest(storeId, endpoint, 'PUT', { quantity }, auth)
                      }
                    }
                  }
                }

                const creationDate = queuedAt.toDate()
                const date = new Date(creationDate)
                const msDate = date.getTime() + 600000
                const dateNow = new Date()
                const msDateNow = dateNow.getTime()
                if (msDate > msDateNow) {
                  console.log('I can overwrite', JSON.stringify(doc.items), 'completed:', doc.completed)
                  await documentRef.set({
                    storeId,
                    items: doc.items,
                    completed: doc.completed,
                    queuedAt
                  })
                }
                if (!res.headersSent) {
                  // done
                  return res.status(201).send(ECHO_SUCCESS)
                }
              }
            }).catch(error => {
              console.error(error)
              const status = error.response
                ? error.response.status || 500 : 409
              return res.sendStatus(status)
            })
          }
          res.sendStatus(204)
        })
        .catch(err => {
          console.log('nao consegui acessar app', err)
      if (err.name === SKIP_TRIGGER_NAME) {
        // trigger ignored by app configuration
        res.send(ECHO_SKIP)
      } else if (err.appWithoutAuth === true) {
        const msg = `Webhook for ${storeId} unhandled with no authentication found`
        const error = new Error(msg)
        error.trigger = JSON.stringify(trigger)
        console.error(error)
        res.status(412).send(msg)
      } else {
        // console.error(err)
        // request to Store API with error response
        // return error status code
        res.status(500)
        const { message } = err
        res.send({
          error: ECHO_API_ERROR,
          message
        })
      }
    })
    })

    
}
